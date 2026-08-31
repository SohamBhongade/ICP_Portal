"use client";

// Per-tab session guard.
//
// THE PROBLEM. Making the auth cookie a session cookie (no Max-Age, no Expires
// — see setSession in lib/auth/index.ts) is necessary but NOT sufficient.
// Chrome's session restore, "continue where you left off", and Ctrl+Shift+T all
// deliberately preserve in-memory session cookies, so a restored tab can walk
// straight back into an authenticated session.
//
// THE FIX. Require a marker that browsers do not restore the same way: a
// `sessionStorage` key written at login time. sessionStorage is scoped to one
// tab and is not repopulated for a tab that is reopened after being closed. So:
//
//     authenticated + marker present  ->  a live, logged-in tab. Do nothing.
//     authenticated + marker absent   ->  a restored or newly-opened tab.
//                                         Log out, send to /login.
//
// ACCEPTED TRADEOFF, confirmed by the product owner: sessionStorage does not
// carry across tabs, so opening a portal link in a NEW tab is indistinguishable
// from a restored one and logs that tab out. That is the price of the guarantee.
//
// WHY fetch() AND NOT THE SERVER ACTION. Importing logoutAction here would pull
// a "use server" module across the client boundary, and it ends in redirect()
// which throws — neither composes with an effect that must await a result and
// then navigate. See app/api/auth/logout/route.ts.
//
// SSR SAFETY. sessionStorage is touched ONLY inside useEffect, which never runs
// during server rendering. Reading it in the render body would both crash SSR
// and desync the first client paint from the server HTML.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Per-tab marker written by the login form. Exported so there is one spelling. */
export const TAB_KEY = "icp_tab_session_id";

/**
 * Circuit-breaker counter.
 *
 * proxy.ts redirects /login -> /dashboard whenever a valid session cookie
 * exists. The logout fetch below is followed by a redirect to /login REGARDLESS
 * of whether it succeeded, so if that request ever fails we would land on
 * /login still holding a live cookie, get bounced back to /dashboard, remount
 * this guard, and loop forever. Counting attempts turns that failure mode into
 * "stays logged in, complains in the console" instead of an infinite bounce.
 */
const ATTEMPT_KEY = "icp_tab_guard_attempts";
const MAX_ATTEMPTS = 2;

/**
 * Write the per-tab marker. Called by the login form immediately before it
 * submits, so it is guaranteed to land before the server action's redirect.
 */
export function markTabSession(): void {
  try {
    // randomUUID is unavailable outside a secure context (plain http on a
    // non-localhost host). The value is only ever compared against "is
    // something here", never parsed, so any unique-ish string will do.
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(TAB_KEY, id);
    sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // Storage blocked (private mode, site-data restrictions). Swallowed on
    // purpose: failing to mark the tab must not block a successful sign-in.
    // The guard fails OPEN for the same reason — see below.
  }
}

export default function SessionTabGuard({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const router = useRouter();

  useEffect(() => {
    if (!isAuthenticated) return;

    let existing: string | null;
    let attempts = 0;
    try {
      existing = sessionStorage.getItem(TAB_KEY);
      attempts = Number(sessionStorage.getItem(ATTEMPT_KEY) ?? "0") || 0;
    } catch {
      // sessionStorage threw (blocked entirely). FAIL OPEN: treat the tab as
      // legitimate. The alternative fails closed and makes the portal unusable
      // for anyone whose browser blocks site data — a far worse outcome than
      // not hardening restored tabs for that minority.
      return;
    }

    if (existing) {
      // Live tab. Clear any stale breaker count so a past failure cannot
      // suppress the guard later in this tab's life.
      if (attempts > 0) {
        try {
          sessionStorage.removeItem(ATTEMPT_KEY);
        } catch {
          /* nothing to do */
        }
      }
      return;
    }

    // Tab was restored or opened without a fresh login.
    if (attempts >= MAX_ATTEMPTS) {
      console.error(
        "[SessionTabGuard] Logout failed repeatedly; stopping to avoid a " +
          "redirect loop. The session is still active — sign out manually.",
      );
      return;
    }

    try {
      sessionStorage.setItem(ATTEMPT_KEY, String(attempts + 1));
    } catch {
      /* breaker unavailable; the MAX_ATTEMPTS branch simply never trips */
    }

    // Call the logout endpoint, then redirect. `.finally` (not `.then`) so a
    // network failure still gets the user off the authenticated page rather
    // than silently leaving them signed in on it.
    let cancelled = false;
    fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
    }).finally(() => {
      if (cancelled) return;
      router.replace("/login?reason=tab_closed");
    });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, router]);

  return null;
}
