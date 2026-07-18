"use client";

// Admin dashboard presentation — live StatCard + dynamic course/year breakdown.
//
// The breakdown is data-driven: one column per course that actually has active
// students, each showing its total and a stat per year present (plus an
// "unspecified" bucket when some students have no year). Nothing is hardcoded to
// B.Pharm/D.Pharm, so new programmes and years render automatically.

import { GraduationCap, Users } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";

export type CourseBreakdown = {
  course: string;
  total: number;
  years: { year: number; count: number }[];
  unspecified: number;
};
export type StudentBreakdown = CourseBreakdown[];

export function AdminOverview({
  activeStudents,
  breakdown,
}: {
  activeStudents: number;
  breakdown: StudentBreakdown;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t("dashboard.statActiveStudents")}
          value={String(activeStudents)}
          icon={Users}
        />
      </div>

      <section className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-ink">
              {t("dashboard.breakdownTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted">
              {t("dashboard.breakdownSubtitle")}
            </p>
          </div>
          <span className="rounded-md bg-mint p-1.5 text-teal">
            <GraduationCap className="size-4" aria-hidden />
          </span>
        </div>

        {breakdown.length === 0 ? (
          <p className="rounded-lg border border-dashed border-line bg-canvas px-4 py-8 text-center text-sm text-muted">
            {t("dashboard.breakdownEmpty")}
          </p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {breakdown.map((c) => (
              <CourseColumn key={c.course} data={c} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

/** One course's total + a stat per year present, styled to match StatCard tokens. */
function CourseColumn({ data }: { data: CourseBreakdown }) {
  const t = useT();
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <div className="flex items-baseline justify-between">
        {/* Course value is already canonical (e.g. "B.pharm"); show it verbatim. */}
        <span className="text-sm font-medium text-ink">{data.course}</span>
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {data.total}
        </span>
      </div>
      <p className="text-xs text-muted">{t("dashboard.totalLabel")}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        {data.years.map((y) => (
          <YearStat
            key={y.year}
            label={t("dashboard.yearLabel", { year: y.year })}
            value={y.count}
          />
        ))}
        {data.unspecified > 0 && (
          <YearStat
            label={t("dashboard.yearUnset")}
            value={data.unspecified}
          />
        )}
      </dl>
    </div>
  );
}

function YearStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-line bg-surface px-3 py-2">
      <dd className="text-lg font-semibold tabular-nums text-ink">{value}</dd>
      <dt className="text-xs text-muted">{label}</dt>
    </div>
  );
}
