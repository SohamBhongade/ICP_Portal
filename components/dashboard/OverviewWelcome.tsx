// The Overview tab's content region.
//
// Phase 7 cleared this page: every stat tile, chart and breakdown widget was
// removed and the three role-specific Overview components were deleted (see the
// Phase 7 report for the list and how to restore them from git).
//
// What is left is deliberately a WELCOME, not a void. An emptied dashboard that
// renders as blank space reads as a broken page; naming the person and their
// role confirms the app loaded, confirms who they are signed in as, and points
// them at the sidebar — which is where everything actually lives now.
//
// Server component: no state, no effects, no client bundle cost. The caller
// does the translating (including interpolating the user's name into the
// greeting), so this stays purely presentational.

import { LayoutDashboard } from "lucide-react";

export function OverviewWelcome({
  roleLabel,
  greeting,
  subtitle,
}: {
  /** Already-translated, human-readable role ("Admin", "Faculty", …). */
  roleLabel: string;
  /** Translated greeting, e.g. "Welcome back, {name}". */
  greeting: string;
  /** Translated supporting line. */
  subtitle: string;
}) {
  return (
    // max-w-5xl + mx-auto matches the width the other dashboard pages use, so
    // the content region does not visibly jump when navigating between tabs.
    <div className="mx-auto max-w-5xl">
      <section className="flex flex-col items-center gap-4 rounded-lg border border-line bg-surface px-6 py-14 text-center shadow-sm sm:py-20">
        <span
          className="flex size-12 items-center justify-center rounded-full bg-lavender text-primary"
          aria-hidden
        >
          <LayoutDashboard className="size-6" />
        </span>

        {/* h1 lives in the topbar, so this is the section heading beneath it. */}
        <h2 className="text-xl font-semibold text-ink sm:text-2xl">
          {greeting}
        </h2>

        <p className="max-w-prose text-sm text-muted">{subtitle}</p>

        <span className="rounded-full bg-canvas px-3 py-1 text-xs font-medium capitalize text-muted">
          {roleLabel}
        </span>
      </section>
    </div>
  );
}
