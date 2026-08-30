// Route gating (Next 16 renamed Middleware -> Proxy; same functionality).
//
// FIRST line of defence for /admin/**, /teacher/**, /student/** and /dashboard.
// It does NOT touch the DB (Edge runtime), so it stays optimistic about account
// STATE — the authoritative checks still run server-side in every page guard and
// every mutation (see lib/auth). What it does enforce, on every matched request:
//
//   1. The session cookie's HMAC SIGNATURE is verified, not merely its presence.
//      A forged or tampered cookie fails verification and is treated as absent,
//      so you cannot hand-craft `icp_session=...` to reach an admin route.
//   2. The signed `exp` claim is re-checked, so an expired token is rejected
//      even though the browser still holds the cookie.
//   3. The role inside the verified token is matched against the shared route
//      model in lib/auth/permissions.
//
// Two distinct outcomes on failure:
//   - no / invalid / expired session -> redirect to /login (with ?next=)
//   - valid session, wrong role      -> REWRITE to /403, which throws
//     forbidden() and renders app/forbidden.tsx with a real HTTP 403. A rewrite
//     keeps the requested URL in the address bar and issues no redirect, so the
//     user is told plainly they lack access instead of being silently bounced
//     somewhere else (which reads as "this route does not exist").

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";
import { canAccessPath } from "@/lib/auth/permissions";
import { RULES, checkRateLimit, clientIp, type RateLimitRule } from "@/lib/rate-limit";

/** Path of the rewrite target that renders the 403 (see app/403/page.tsx). */
const FORBIDDEN_PATH = "/403";

// ---------------------------------------------------------------------------
// Content-Security-Policy (Phase 5)
// ---------------------------------------------------------------------------
//
// Built HERE rather than in next.config.ts because a strong CSP needs a fresh
// nonce per request, and only the proxy sees the request. Next reads the nonce
// out of the CSP header we set on the REQUEST and stamps it onto its own
// framework/bundle script tags automatically.
//
// The usual cost of nonce-based CSP is that it forces dynamic rendering. That
// costs this app nothing: every route is already dynamic because the whole
// portal is session-gated, so there is no static generation or CDN caching to
// give up.
//
// WHERE THIS POLICY IS DELIBERATELY NOT STRICT - and why:
//
//   style-src ... 'unsafe-inline'
//     React writes inline style="..." ATTRIBUTES (next/image with fill,
//     Recharts in the analytics view, assorted layout styles). A nonce cannot
//     authorize a style ATTRIBUTE - nonces only apply to <style> elements - so
//     a nonce-only style-src blocks them and the app renders unstyled and
//     broken. 'unsafe-inline' on styles is the standard, accepted trade-off:
//     it permits CSS injection tricks but NOT script execution, which is what
//     actually matters for XSS. See the Phase 5 report for how to tighten it.
//
//   'unsafe-eval' in development only
//     React uses eval() in dev to reconstruct server error stacks. Never
//     emitted in a production build.
//
// script-src stays strict ('self' + nonce + strict-dynamic), which is the
// directive that actually stops injected script from running.
function buildCsp(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // See the note above: inline style ATTRIBUTES cannot carry a nonce.
    `style-src 'self' 'unsafe-inline'`,
    // next/image emits blob:/data: sources; the campus photo and logo are local.
    `img-src 'self' blob: data:`,
    // next/font self-hosts Geist at build time, so no external font origin.
    `font-src 'self'`,
    // Server Actions POST to this same origin and nowhere else.
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    // Clickjacking. Modern equivalent of X-Frame-Options, which is also set.
    `frame-ancestors 'none'`,
    `frame-src 'none'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

/**
 * Attach the per-request security headers to whatever response we return, so a
 * redirect, a 403, and a 429 all carry the same policy as a rendered page.
 */
function withSecurityHeaders(
  response: NextResponse,
  csp: string,
): NextResponse {
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

/**
 * Routes that must remain reachable WITHOUT a session. They are matched by the
 * proxy (so they still get CSP, rate limiting and the cross-origin check) but
 * skip the authentication gate.
 */
function isPublicPath(pathname: string): boolean {
  return (
    pathname === "/" ||
    pathname === "/login" ||
    pathname === "/403" ||
    pathname === "/style-guide" ||
    pathname === "/request-account" ||
    pathname.startsWith("/request-account/") ||
    pathname.startsWith("/style-guide/")
  );
}

// ---------------------------------------------------------------------------
// Per-IP rate limiting
// ---------------------------------------------------------------------------
//
// This is the ONLY place in the app that can answer with a real HTTP 429 and a
// Retry-After header, because middleware returns a Response and a Server Action
// does not. Server Actions POST to the URL of the page hosting them, so
// throttling POSTs to these paths throttles the actions invoked from them.
//
// Only POST is throttled: GETs are page reads, and rate-limiting navigation
// would punish ordinary use. The complementary PER-IDENTIFIER limits live in
// the actions themselves (the identifier is in the body, which middleware must
// not consume — doing so would leave nothing for the action to read).
const THROTTLED_POST_PATHS: { prefix: string; rule: RateLimitRule }[] = [
  // Unauthenticated and the highest-value target: credential stuffing.
  { prefix: "/login", rule: RULES.loginIp },
  // Unauthenticated: automated signup spam.
  { prefix: "/request-account", rule: RULES.requestAccountIp },
  // Authenticated admin console. Covers user create/edit, the CSV/XLSX import,
  // and bulk delete, which all POST to this path.
  { prefix: "/admin/users", rule: RULES.adminMutationIp },
  // Approvals assign passwords, so they count as a password operation.
  { prefix: "/admin/requests", rule: RULES.adminMutationIp },
];

/** 429 with the headers a well-behaved client (and a scanner) expects. */
function tooManyRequests(retryAfter: number): NextResponse {
  return new NextResponse(
    "Too many requests. Please wait before trying again.",
    {
      status: 429,
      headers: {
        "Retry-After": String(retryAfter),
        "Content-Type": "text/plain; charset=utf-8",
        // Never let an intermediary cache a throttle response.
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * Reject state-changing requests that did not originate from this site.
 *
 * Next.js already compares Origin to Host for Server Actions and aborts on a
 * mismatch (its built-in CSRF defence). This is belt-and-braces at the edge, and
 * it also covers any Route Handler added later, which gets NO such protection
 * for free. A missing Origin header is allowed through: non-browser clients
 * (curl, health checks) omit it, and browsers always send it on cross-origin
 * POSTs — which are exactly the ones this is here to stop.
 */
function isCrossOriginWrite(request: NextRequest): boolean {
  if (request.method === "GET" || request.method === "HEAD") return false;
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (!host) return false;
  try {
    return new URL(origin).host !== host;
  } catch {
    // An unparseable Origin is not something a browser sends. Treat as hostile.
    return true;
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // One fresh nonce per request. crypto.randomUUID() is available on the Edge
  // runtime and is cryptographically random, which is the requirement - a
  // guessable nonce is no protection at all.
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Next extracts the nonce from the CSP header on the REQUEST and applies it
  // to the script tags it renders, so it has to be set on both request and
  // response.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);
  const passThrough = () =>
    withSecurityHeaders(
      NextResponse.next({ request: { headers: requestHeaders } }),
      csp,
    );

  // CSRF, layer 1 (layer 2 is SameSite=Lax on the session cookie, layer 3 is
  // Next's own Origin/Host check on every Server Action).
  if (isCrossOriginWrite(request)) {
    return withSecurityHeaders(
      new NextResponse("Cross-origin request rejected.", {
        status: 403,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      }),
      csp,
    );
  }

  // Rate limiting BEFORE authentication: an unauthenticated flood is precisely
  // what needs stopping, and the check must not depend on a valid session.
  if (request.method === "POST") {
    const throttle = THROTTLED_POST_PATHS.find((t) =>
      pathname.startsWith(t.prefix),
    );
    if (throttle) {
      const result = await checkRateLimit(
        throttle.rule,
        clientIp(request.headers),
      );
      if (!result.allowed) {
        return withSecurityHeaders(tooManyRequests(result.retryAfter), csp);
      }
    }
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;

  // Signature + expiry verification. Throws only if AUTH_SECRET itself is
  // missing/weak (AuthConfigError) — deliberately NOT caught here, so a
  // misconfigured deployment fails loudly and closed rather than silently
  // treating every visitor as signed out.
  const session = await verifySessionToken(token);

  // Already signed in but visiting /login -> send to dashboard.
  if (pathname === "/login" && session) {
    return withSecurityHeaders(
      NextResponse.redirect(new URL("/dashboard", request.url)),
      csp,
    );
  }

  // PUBLIC routes are matched by the proxy so they still receive the CSP, the
  // rate limit and the cross-origin check - but they must never be pushed to
  // /login, or nobody could sign in or request an account.
  if (isPublicPath(pathname)) return passThrough();

  // All other matched paths require authentication.
  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return withSecurityHeaders(NextResponse.redirect(loginUrl), csp);
  }

  // Capability-based gating (shared model in lib/auth/permissions). Authenticated
  // but under-privileged -> 403 page, NOT a silent redirect.
  if (!canAccessPath(session.role, pathname)) {
    return withSecurityHeaders(
      NextResponse.rewrite(new URL(FORBIDDEN_PATH, request.url), {
        status: 403,
        request: { headers: requestHeaders },
      }),
      csp,
    );
  }

  return passThrough();
}

export const config = {
  // EVERY page request, so the per-request CSP nonce reaches all of them.
  // Excluded: Next's own static output and the image optimizer (immutable
  // assets that need no policy and would only defeat caching), plus favicon and
  // the two static images in /public.
  //
  // Widening this from the previous auth-only list is why isPublicPath() exists:
  // public routes are matched for CSP/rate-limiting but skip the auth gate.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|logo.png|campus-bg.webp).*)",
  ],
};
