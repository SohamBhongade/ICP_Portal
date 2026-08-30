// 403 screen (Next.js `forbidden.tsx` convention).
//
// Rendered whenever forbidden() is thrown — from a page guard, a layout guard,
// a server action, or via the /403 route the proxy rewrites wrong-role requests
// to. Next returns a real HTTP 403 with it.
//
// Why a 403 and not a redirect: bouncing an authenticated user to some other
// page is indistinguishable from the route not existing, which hides genuine
// permission bugs and leaves people guessing. This says plainly that the route
// is real and their account cannot open it.
//
// Deliberately self-contained (no DashboardShell): it must render for any role,
// including one whose console layout would itself re-run a failing guard.

import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { getT } from "@/lib/i18n/server";

export default async function Forbidden() {
  const t = await getT();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-md rounded-lg border border-line bg-surface p-6 text-center shadow-sm sm:p-8">
        <ShieldAlert className="mx-auto size-10 text-danger" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold text-ink">
          {t("forbidden.title")}
        </h1>
        <p className="mt-2 text-sm text-muted">{t("forbidden.body")}</p>
        <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
          <Link
            href="/dashboard"
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
          >
            {t("forbidden.backToDashboard")}
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-lavender"
          >
            {t("forbidden.switchAccount")}
          </Link>
        </div>
      </div>
    </main>
  );
}
