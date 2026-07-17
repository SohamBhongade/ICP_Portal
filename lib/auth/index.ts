// Server-only auth helpers: read/set/clear the session cookie and load the
// current user from the DB. Used by pages and server actions (Node runtime).
// NOT imported by proxy.ts (that only needs session.ts).

import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
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
  landingPath,
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

/** Issue a session cookie for a user. */
export async function setSession(
  payload: Omit<SessionPayload, "exp">,
): Promise<void> {
  const token = await createSessionToken(payload);
  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
}

/** Remove the session cookie (logout). */
export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
}

/** Page guard: redirect to /login if not authenticated, else return the user. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Page guard: require a specific role (redirects otherwise). */
export async function requireRole(...roles: Role[]): Promise<User> {
  const user = await requireUser();
  if (!roles.includes(user.role as Role)) redirect("/dashboard");
  return user;
}

/**
 * Page guard: require a single capability. On failure the user is bounced to
 * their own role's landing page (never a generic 403 screen — keeps navigation
 * coherent for the mixed staff roles).
 */
export async function requireCapability(
  capability: Capability,
): Promise<User> {
  const user = await requireUser();
  if (!can(user.role as Role, capability)) {
    redirect(landingPath(user.role as Role));
  }
  return user;
}

/** Page guard: require ANY of the listed capabilities. */
export async function requireAnyCapability(
  ...capabilities: Capability[]
): Promise<User> {
  const user = await requireUser();
  if (!canAny(user.role as Role, ...capabilities)) {
    redirect(landingPath(user.role as Role));
  }
  return user;
}

/**
 * Server-action guard (non-redirecting): returns the current user only if they
 * hold `capability`, else null so the action can return a `forbidden` result.
 */
export async function currentUserWithCapability(
  capability: Capability,
): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || !can(user.role as Role, capability)) return null;
  return user;
}
