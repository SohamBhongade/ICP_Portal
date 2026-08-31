// Instant loading state for Admin > Users.
//
// The page is a server component that awaits four queries, so on navigation
// there is a real gap before the grid appears. This mirrors the loaded layout
// (header, filter rail, search, table) so nothing jumps when content streams in.

import { UsersTableSkeleton } from "./UsersTable";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-2">
          <div className="h-6 w-48 animate-pulse rounded bg-lavender" />
          <div className="h-4 w-72 animate-pulse rounded bg-line" />
        </div>
        <div className="flex gap-2">
          <div className="h-9 w-32 animate-pulse rounded-md bg-lavender" />
          <div className="h-9 w-28 animate-pulse rounded-md bg-lavender" />
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        <aside className="w-full shrink-0 lg:w-60">
          <div className="space-y-4 rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="h-4 w-20 animate-pulse rounded bg-line" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-1.5">
                <div className="h-3 w-16 animate-pulse rounded bg-line" />
                <div className="h-9 w-full animate-pulse rounded-md bg-lavender" />
              </div>
            ))}
          </div>
        </aside>

        <section className="min-w-0 flex-1">
          <div className="mb-4 h-10 w-full animate-pulse rounded-md bg-lavender" />
          <div className="mb-3 h-4 w-32 animate-pulse rounded bg-line" />
          <UsersTableSkeleton />
        </section>
      </div>
    </div>
  );
}
