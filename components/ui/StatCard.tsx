// Simple metric card for dashboard overviews. Server-component friendly.

import type { LucideIcon } from "lucide-react";

export function StatCard({
  label,
  value,
  icon: Icon,
  tone = "lavender",
}: {
  label: string;
  value: string;
  icon: LucideIcon;
  tone?: "lavender" | "mint";
}) {
  const toneClasses =
    tone === "mint" ? "bg-mint text-teal" : "bg-lavender text-primary";
  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted">{label}</span>
        <span className={`rounded-md p-1.5 ${toneClasses}`}>
          <Icon className="size-4" aria-hidden />
        </span>
      </div>
      <p className="mt-2 text-2xl font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
