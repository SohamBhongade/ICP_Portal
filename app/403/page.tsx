// Rewrite target for proxy.ts.
//
// Middleware/proxy runs on the Edge and cannot call forbidden() itself, so when
// it catches an authenticated user requesting a route their role cannot open it
// REWRITES the request here (the browser's URL is untouched — no redirect, so
// nothing is leaked about where they were sent). This page then throws
// forbidden(), which renders app/forbidden.tsx with a real HTTP 403 status.

import { forbidden } from "next/navigation";

export default function ForbiddenRoute(): never {
  forbidden();
}
