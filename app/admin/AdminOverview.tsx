"use client";

// Admin dashboard presentation — live StatCard + course/year breakdown.

import { GraduationCap, Users } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";

export type CourseBreakdown = { total: number; year1: number; year2: number };
export type StudentBreakdown = {
  bpharm: CourseBreakdown;
  dpharm: CourseBreakdown;
};

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

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <CourseColumn
            title={t("dashboard.courseBPharm")}
            data={breakdown.bpharm}
          />
          <CourseColumn
            title={t("dashboard.courseDPharm")}
            data={breakdown.dpharm}
          />
        </div>
      </section>
    </div>
  );
}

/** One course's total + per-year breakdown, styled to match StatCard tokens. */
function CourseColumn({
  title,
  data,
}: {
  title: string;
  data: CourseBreakdown;
}) {
  const t = useT();
  return (
    <div className="rounded-lg border border-line bg-canvas p-4">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-ink">{title}</span>
        <span className="text-2xl font-semibold tabular-nums text-ink">
          {data.total}
        </span>
      </div>
      <p className="text-xs text-muted">{t("dashboard.totalLabel")}</p>

      <dl className="mt-3 grid grid-cols-2 gap-2">
        <YearStat label={t("dashboard.year1")} value={data.year1} />
        <YearStat label={t("dashboard.year2")} value={data.year2} />
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
