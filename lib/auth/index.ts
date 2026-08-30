// Server-only auth helpers: read/set/clear the session cookie and load the
// current user from the DB. Used by pages and server actions (Node runtime).
// NOT imported by proxy.ts (that only needs session.ts).

import "server-only";
import { cookies } from "next/headers";
import { forbidden, redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type User } from "@/db/schema";
import {
  SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createSessionToken,
  verifySessionToken,
  type Role,
  type SessionPayload,
} from "./session";
import {
  can,
  canAny,
  canReadStudentData,
  type Capability,
} from "./permissions";

/** Read + verify the session payload from the cookie (no DB hit). */
export async function getSession(): Promise<SessionPayload | null> {
  const store = await cookies();
  return verifySessionToken(store.get(SESSION_COOKIE)?.value);
}

/** Load the full, currently-active user, or null. */
export async function getCurrentUser(): Promise<User | null> {
  const session = await getSession();
  if (!session) return null;

  const [user] = await db
    .select()
    .from(users)
    .where(eq(users.id, session.userId))
    .limit(1);

  // Reject if the account was deactivated after the cookie was issued.
  if (!user || user.status !== "active") return null;
  return user;
}

/**
 * Cookie attributes for the session, kept in ONE place so the cookie cleared on
 * logout is attribute-for-attribute the cookie that was set on login (a
 * mismatched Path or SameSite leaves an orphan the browser keeps sending).
 *
 *   httpOnly  — never readable from JavaScript, so XSS cannot exfiltrate it.
 *   secure    — HTTPS-only in production. Left off in dev so http://localhost
 *               still works; NODE_ENV is build-time, not attacker-controlled.
 *   sameSite  — "lax": not sent on cross-site POSTs (CSRF), still sent on
 *               top-level navigation so following a link keeps you signed in.
 *   path      — explicit "/": one cookie for the whole app, one to clear.
 *   maxAge    — explicit lifetime, mirroring the signed `exp` inside the token
 *               (the token's exp is what is actually enforced per request).
 */
const SESSION_COOKIE_OPTIONS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax",
  path: "/",
} as const;

/** Issue a session cookie for a user. */
export async function setSession(
  payload: Omit<SessionPayload, "exp">,
): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/**
 * Invalidate the session (logout). Sessions are stateless signed tokens, so
 * invalidation is a SERVER-SENT Set-Cookie header, not a client-side delete.
 *
 * We do both: overwrite the cookie with an empty value and Max-Age=0 using the
 * identical attributes it was set with, then delete it. The overwrite is the
 * part that reliably evicts it — a bare delete can miss when attributes differ,
 * leaving the old token in the jar.
 */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE, "", {
    ...SESSION_COOKIE_OPTIONS,
    maxAge: 0,
    expires: new Date(0),
  });
  store.delete(SESSION_COOKIE);
}

/** Page guard: redirect to /login if not authenticated, else return the user. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

// ---------------------------------------------------------------------------
// THE reusable server-side authorization helpers.
//
// Each returns the verified session user or THROWS — they never hand back a
// boolean a caller can forget to check. Two distinct failure modes, on purpose:
//
//   not signed in         -> redirect("/login")
//                            Nothing to show; signing in is the only outcome
//                            that helps them.
//   signed in, wrong role -> forbidden()  =>  app/forbidden.tsx, HTTP 403
//                            NOT a silent redirect. Bouncing someone elsewhere
//                            is indistinguishable from "that route does not
//                            exist", which hides real permission bugs from
//                            users and from us.
//
// Client-side role checks (hidden buttons, filtered nav) are presentation only.
// These helpers are the gate.
// ---------------------------------------------------------------------------

/**
 * Page / action guard: require one of the given roles.
 *
 * Accepts either call style, so `requireRole(["admin"])` and
 * `requireRole("student", "admin")` both work.
 */
export async function requireRole(
  ...roles: (Role | Role[])[]
): Promise<User> {
  const allowed = roles.flat();
  const user = await requireUser();
  if (!allowed.includes(user.role as Role)) forbidden();
  return user;
}

/** Page / action guard: require a single capability, else 403. */
export async function requireCapability(
  capability: Capability,
): Promise<User> {
  const user = await requireUser();
  if (!can(user.role as Role, capability)) forbidden();
  return user;
}

/** Page / action guard: require ANY of the listed capabilities, else 403. */
export async function requireAnyCapability(
  ...capabilities: Capability[]
): Promise<User> {
  const user = await requireUser();
  if (!canAny(user.role as Role, ...capabilities)) forbidden();
  return user;
}

/**
 * Ownership guard for any read that accepts a student id from the caller.
 * Returns the verified actor, or 403s. The id is compared against the SESSION
 * user, so a student can only ever address their own records no matter what the
 * URL or payload says.
 */
export async function requireStudentDataAccess(
  targetStudentId: number,
): Promise<User> {
  const user = await requireUser();
  const actor = { id: user.id, role: user.role as Role };
  if (!canReadStudentData(actor, targetStudentId)) forbidden();
  return user;
}

/**
 * Non-throwing variant, for server actions whose UI renders a translated
 * "forbidden" toast instead of a 403 page. Returns the current user only if
 * they hold `capability`, else null.
 *
 * This is the SAME check as requireCapability — called at the top of the
 * action, on the server, before any work happens — it just reports the denial
 * through the action's typed result rather than an interrupt. Every call site
 * returns early on null; there is no path where a null actor proceeds.
 */
export async function currentUserWithCapability(
  capability: Capability,
): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || !can(user.role as Role, capability)) return null;
  return user;
}
