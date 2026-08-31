// POST /api/auth/logout — clear the session cookie and return 200.
//
// WHY A ROUTE HANDLER AT ALL, in a codebase that otherwise has none.
//
// Every other mutation in this app is a Server Action (see the note at the top
// of app/actions/preferences.ts); this is the single documented exception. The
// caller is components/auth/SessionTabGuard.tsx, a "use client" component that
// needs to sign the user out from inside a useEffect. Importing logoutAction
// there would drag a "use server" module across the client boundary, and
// logoutAction also ends in redirect(), which throws — neither composes with a
// guard that has to await the result and then navigate itself.
//
// So: a plain POST endpoint that does exactly one thing and returns a value the
// client can branch on.
//
// SECURITY NOTES
//   - POST only. A GET logout endpoint is drive-by loggable-outable from any
//     <img> tag on the internet; the other verbs return 405.
//   - CSRF: proxy.ts matches "/((?!_next/static|…).*)", so this path already
//     passes through the same cross-origin write check as every other POST in
//     the app (a forged cross-site POST is answered with 403 before it reaches
//     this handler). The check below is belt-and-braces for the case where that
//     matcher is ever narrowed.
//   - No body is read and nothing is echoed back, so there is no injection
//     surface and no oracle here.
//   - Logging out is idempotent and safe for an unauthenticated caller: the
//     worst outcome is clearing a cookie that was not there. It therefore does
//     NOT require an authenticated session, which matters because the guard may
//     be racing an already-expired token.

import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { clearSession } from "@/lib/auth";

/** Reject a cross-site POST. Mirrors isCrossOriginWrite() in proxy.ts. */
async function isSameOrigin(): Promise<boolean> {
  const h = await headers();
  const origin = h.get("origin");
  // No Origin header at all (same-origin form posts, some proxies) is allowed —
  // proxy.ts applies the same rule, and Origin is mandatory on cross-site
  // fetches, which is the case that matters.
  if (!origin) return true;
  const host = h.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function POST() {
  if (!(await isSameOrigin())) {
    return new NextResponse("Cross-origin request rejected.", { status: 403 });
  }

  await clearSession();

  // 200 with a tiny JSON body so the caller can check `response.ok`. The
  // Set-Cookie header written by clearSession() rides along on this response.
  return NextResponse.json(
    { ok: true },
    // The response must never be cached — a cached logout would be a no-op the
    // second time and would leave the tab guard looping.
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
