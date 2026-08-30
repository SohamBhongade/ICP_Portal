// Rate-limit storage, behind an interface so the backend can be swapped.
//
// WHY THIS IS NOT AN IN-MEMORY MAP
// --------------------------------
// This app deploys to Vercel serverless. Every invocation may be a fresh
// lambda, and concurrent invocations never share memory. A module-level Map is
// therefore not "one limit" — it is one limit PER WARM INSTANCE, so an attacker
// spraying requests across instances gets an arbitrary multiple of the intended
// allowance, and a cold start resets the counter to zero. In-memory counters do
// not rate-limit anything on serverless.
//
// So the default store is DURABLE and backed by Turso (libSQL), which this app
// is already connected to — no new service, no new credentials. SQLite's
// `INSERT … ON CONFLICT DO UPDATE` is atomic within one statement, which makes
// the increment correct under concurrent invocations.
//
// Trade-offs, stated plainly:
//   - One extra DB round trip (~30–80 ms) on the throttled endpoints only.
//   - FIXED window, not sliding: a burst straddling a window boundary can send
//     up to 2x the limit across the seam. Adequate for credential stuffing and
//     bulk-import abuse; a sliding window would need a second table.
//   - At genuinely high write volume, SQLite contention becomes the bottleneck.
//     That is the point at which to implement `RateLimitStore` against
//     Upstash/Redis — one new class and one line in getRateLimitStore().
//
// MemoryRateLimitStore exists only as a DEGRADED FALLBACK: if the durable store
// throws (table missing, DB unreachable), we fall back to it and log loudly
// rather than failing every login. That is best-effort under serverless — see
// the header note in lib/rate-limit/index.ts.

import { createClient, type Client } from "@libsql/client/web";

/** Outcome of one increment against a limiter. */
export type RateLimitHit = {
  /** Requests recorded in the CURRENT window, including this one. */
  count: number;
  /** Epoch seconds at which the current window ends. */
  resetAt: number;
};

export interface RateLimitStore {
  /**
   * Atomically record one hit against `key` and return the running count for
   * the current window. Implementations MUST reset the counter when the window
   * has elapsed, and MUST be safe under concurrent callers.
   */
  hit(key: string, windowSeconds: number, now: number): Promise<RateLimitHit>;
  /** Human-readable name, for logs and the report. */
  readonly name: string;
}

// ---------------------------------------------------------------------------
// Durable: Turso / libSQL
// ---------------------------------------------------------------------------

/**
 * The `/web` entrypoint is the fetch-based build, so this same store works from
 * the Edge runtime (proxy.ts) and from Node (server actions) unchanged.
 */
let client: Client | null = null;
function getClient(): Client {
  if (client) return client;
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return client;
}

export class TursoRateLimitStore implements RateLimitStore {
  readonly name = "turso";

  async hit(
    key: string,
    windowSeconds: number,
    now: number,
  ): Promise<RateLimitHit> {
    const db = getClient();

    // ONE atomic statement does all of it:
    //   - no row yet                  -> insert with count = 1
    //   - row exists, window still open -> count = count + 1
    //   - row exists, window elapsed    -> count resets to 1, window restarts
    // RETURNING hands back the post-update values, so there is no read-then-
    // write race between concurrent lambdas.
    const result = await db.execute({
      sql: `
        INSERT INTO rate_limits (key, count, window_start, expires_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(key) DO UPDATE SET
          count = CASE
            WHEN rate_limits.window_start + ? <= ? THEN 1
            ELSE rate_limits.count + 1
          END,
          window_start = CASE
            WHEN rate_limits.window_start + ? <= ? THEN ?
            ELSE rate_limits.window_start
          END,
          expires_at = CASE
            WHEN rate_limits.window_start + ? <= ? THEN ?
            ELSE rate_limits.expires_at
          END
        RETURNING count, window_start
      `,
      args: [
        key,
        now,
        now + windowSeconds,
        windowSeconds,
        now,
        windowSeconds,
        now,
        now,
        windowSeconds,
        now,
        now + windowSeconds,
      ],
    });

    const row = result.rows[0];
    const count = Number(row?.count ?? 1);
    const windowStart = Number(row?.window_start ?? now);
    return { count, resetAt: windowStart + windowSeconds };
  }

  /**
   * Delete expired rows. Called opportunistically (roughly 1 request in 50), so
   * the table stays small without a cron job. Failures are ignored — pruning is
   * housekeeping, never a reason to reject a request.
   */
  async prune(now: number): Promise<void> {
    try {
      await getClient().execute({
        sql: `DELETE FROM rate_limits WHERE expires_at <= ?`,
        args: [now],
      });
    } catch {
      // Intentionally silent.
    }
  }
}

// ---------------------------------------------------------------------------
// Degraded fallback: in-process memory
// ---------------------------------------------------------------------------

/**
 * BEST-EFFORT ONLY. Correct in a single long-lived process (local `next dev`,
 * a container, a VM); on serverless it is per-instance and resets on cold
 * start. Never the primary store — see the file header.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  readonly name = "memory";
  private readonly buckets = new Map<
    string,
    { count: number; windowStart: number }
  >();

  async hit(
    key: string,
    windowSeconds: number,
    now: number,
  ): Promise<RateLimitHit> {
    const existing = this.buckets.get(key);
    if (!existing || existing.windowStart + windowSeconds <= now) {
      this.buckets.set(key, { count: 1, windowStart: now });
      return { count: 1, resetAt: now + windowSeconds };
    }
    existing.count += 1;
    return {
      count: existing.count,
      resetAt: existing.windowStart + windowSeconds,
    };
  }

  /** Bound the map so a long-lived process cannot grow it without limit. */
  prune(now: number, windowSeconds: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.windowStart + windowSeconds <= now) this.buckets.delete(key);
    }
  }
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

const durableStore = new TursoRateLimitStore();
export const fallbackStore = new MemoryRateLimitStore();

/**
 * The active store. Turso whenever it is configured — which is always, since
 * the app cannot run without it — otherwise the in-memory fallback so local
 * experiments without a database still work.
 *
 * TO SWAP IN REDIS/UPSTASH: implement RateLimitStore against it and return that
 * instance here. Nothing else in the codebase changes.
 */
export function getRateLimitStore(): RateLimitStore {
  return process.env.TURSO_DATABASE_URL ? durableStore : fallbackStore;
}

export { durableStore };
