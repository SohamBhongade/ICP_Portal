// Route gating (Next 16 renamed Middleware -> Proxy; same functionality).
//
// This is an OPTIMISTIC check: it verifies the signed session cookie (role is
// inside the token) and redirects unauthenticated/under-privileged users. It
// does NOT touch the DB (Edge runtime). Authoritative role checks still happen
// server-side in every mutation (see guardrails).

import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, verifySessionToken, type Role } from "@/lib/auth/session";

// Path prefix -> roles allowed to access it.
const ROLE_RULES: { prefix: string; roles: Role[] }[] = [
  { prefix: "/admin", roles: ["admin"] },
  { prefix: "/teacher", roles: ["teacher", "admin"] },
  { prefix: "/student", roles: ["student", "admin"] },
  // /dashboard: any authenticated user (no role restriction)
];

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const session = await verifySessionToken(token);

  // Already signed in but visiting /login -> send to dashboard.
  if (pathname === "/login") {
    if (session) {
      return NextResponse.redirect(new URL("/dashboard", request.url));
    }
    return NextResponse.next();
  }

  // All other matched paths require authentication.
  if (!session) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Role-specific gating.
  const rule = ROLE_RULES.find((r) => pathname.startsWith(r.prefix));
  if (rule && !rule.roles.includes(session.role)) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/login",
    "/dashboard/:path*",
    "/admin/:path*",
    "/teacher/:path*",
    "/student/:path*",
  ],
};
