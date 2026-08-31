// Rate-limit rules and the check entry point.
//
// Edge-safe: this module and lib/rate-limit/store.ts import only the fetch-based
// libSQL build, so proxy.ts (Edge runtime) and the server actions (Node) share
// exactly the same rules and the same durable counters.
//
// TWO ENFORCEMENT POINTS, on purpose:
//
//   proxy.ts (per IP)         -> can return a real HTTP 429 with Retry-After,
//                                because middleware returns a Response.
//   server actions (per identity)
//                             -> a Server Action returns a VALUE, not a
//                                Response; it cannot set a status code or a
//                                header. It therefore returns a typed
//                                { error: "rateLimited", retryAfter } result
//                                and the UI renders the wait. The proxy cannot
//                                do this check itself because the identifier
//                                lives in the POST body, and consuming the body
//                                in middleware would leave nothing for the
//                                action to read.
//
// Together they close the evasion loop the brief asks for: rotating IPs still
// trips the per-identifier limit, and rotating identifiers still trips the
// per-IP limit.

import {
  durableStore,
  fallbackStore,
  getRateLimitStore,
  type RateLimitStore,
} from "./store";

export type RateLimitRule = {
  /** Stable prefix for the storage key; also what shows up in logs. */
  readonly name: string;
  /** Maximum requests permitted per window. */
  readonly limit: number;
  /** Window length in seconds. */
  readonly windowSeconds: number;
};

/**
 * Every throttled surface in the app, in one table.
 *
 * Limits are deliberately generous enough for real classroom use (a registrar
 * onboarding a cohort, a student mistyping a password a few times) and tight
 * enough to make credential stuffing and bulk scraping impractical.
 */
export const RULES = {
  /** Sign-in attempts from one IP. Catches identifier rotation. */
  loginIp: { name: "login:ip", limit: 10, windowSeconds: 15 * 60 },
  /** Sign-in attempts against one account. Catches IP rotation. */
  loginIdentifier: { name: "login:id", limit: 5, windowSeconds: 15 * 60 },
  /** Public signup — unauthenticated, so the tightest IP limit in the app. */
  requestAccountIp: { name: "request:ip", limit: 5, windowSeconds: 60 * 60 },
  /** Repeat signups naming the same person. */
  requestAccountIdentity: { name: "request:id", limit: 3, windowSeconds: 60 * 60 },
  /** Authenticated admin console POSTs (create/edit/delete/import). */
  adminMutationIp: { name: "admin:ip", limit: 60, windowSeconds: 10 * 60 },
  /** File imports specifically — each one parses a whole spreadsheet. */
  importUser: { name: "import:user", limit: 10, windowSeconds: 10 * 60 },
  /** Account deletions, per admin. Bounds a runaway bulk delete. */
  deleteUser: { name: "delete:user", limit: 30, windowSeconds: 10 * 60 },
  /**
   * BULK deletions, per admin — counted per OPERATION, not per account.
   * Deliberately separate from `deleteUser`: one bulk call can remove up to
   * BULK_DELETE_MAX accounts, so charging it a single hit against the
   * per-account rule would let a script erase the roster inside the allowance.
   * Five sweeps per ten minutes is well above any real registrar workflow.
   */
  bulkDeleteUsers: { name: "delete:bulk", limit: 5, windowSeconds: 10 * 60 },
  /** Custom-column definition changes (create / rename / delete), per admin. */
  userFieldMutation: { name: "field:user", limit: 30, windowSeconds: 10 * 60 },
  /** Password assignment (approve / activate), per admin. */
  passwordOpUser: { name: "password:user", limit: 30, windowSeconds: 10 * 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitResult = {
  allowed: boolean;
  /** Seconds the caller should wait. 0 when allowed. */
  retryAfter: number;
  /** Requests left in this window (never negative). */
  remaining: number;
  /** Which store answered — "memory" means the durable one failed. */
  store: string;
};

/** Subject identifiers are lowercased and capped so one key cannot bloat a row. */
function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase().slice(0, 200) || "unknown";
}

/**
 * Record one hit and decide whether to allow it.
 *
 * FAILURE POLICY: if the durable store throws (table missing, database
 * unreachable), we do NOT reject the request — a database hiccup must not lock
 * every user out of signing in. We fall back to the in-memory limiter, which
 * still catches a burst hitting one warm instance, and log loudly so the
 * outage is visible. Degraded, never silently unprotected, never a lockout.
 */
export async function checkRateLimit(
  rule: RateLimitRule,
  subject: string,
): Promise<RateLimitResult> {
  const now = Math.floor(Date.now() / 1000);
  const key = `${rule.name}:${normalizeSubject(subject)}`;

  let store: RateLimitStore = getRateLimitStore();
  let hit;
  try {
    hit = await store.hit(key, rule.windowSeconds, now);
  } catch (err) {
    console.error(
      `[rate-limit] durable store failed for ${rule.name}; falling back to ` +
        `in-memory (per-instance, best-effort). Fix the store — throttling is ` +
        `degraded until you do.`,
      err,
    );
    store = fallbackStore;
    hit = await store.hit(key, rule.windowSeconds, now);
  }

  // Opportunistic pruning: ~2% of calls, so the table stays small with no cron.
  if (store === durableStore && Math.random() < 0.02) {
    void durableStore.prune(now);
  } else if (store === fallbackStore && Math.random() < 0.02) {
    fallbackStore.prune(now, rule.windowSeconds);
  }

  const allowed = hit.count <= rule.limit;
  return {
    allowed,
    retryAfter: allowed ? 0 : Math.max(1, hit.resetAt - now),
    remaining: Math.max(0, rule.limit - hit.count),
    store: store.name,
  };
}

// ---------------------------------------------------------------------------
// Client IP
// ---------------------------------------------------------------------------

/**
 * Best available client IP.
 *
 * On Vercel the platform sets `x-forwarded-for` and appends the real client as
 * the FIRST entry; everything after it is proxy hops. We take the first entry
 * only — trusting the last would let a caller prepend a forged address, and
 * trusting the whole header would let them rotate the key at will.
 *
 * Note the inherent limit of any IP-based rule: NAT and shared campus Wi-Fi put
 * many legitimate users behind one address. That is why the per-IP limits here
 * are the looser of the pair and the per-identifier limits are the strict ones.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return (
    headers.get("x-real-ip")?.trim() ||
    headers.get("cf-connecting-ip")?.trim() ||
    "unknown"
  );
}
