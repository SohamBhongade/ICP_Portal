"use client";

// Student attendance — premium summary (StatCards) + a monthly calendar ledger.
//
// Calendar aggregates per day: a day with any absence reads as "absent" tone,
// an all-present day reads "present", days with no class stay neutral. Month/
// weekday labels are localized via Intl using the active UI locale.

import { useMemo, useState } from "react";
import {
  CalendarCheck,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Percent,
} from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { Editable } from "@/components/edit-mode/Editable";
import { useT, useLocale } from "@/components/i18n/LanguageProvider";

type Log = {
  date: string;
  status: "present" | "absent" | "late";
  subject: string | null;
};

const pad = (n: number) => String(n).padStart(2, "0");

export function StudentAttendanceView({
  logs,
  total,
  attended,
  pct,
}: {
  logs: Log[];
  total: number;
  attended: number;
  pct: number;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="attendance.student.title" />
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t("attendance.student.percentage")}
          value={total ? `${pct}%` : "—"}
          icon={Percent}
          tone="mint"
        />
        <StatCard
          label={t("attendance.student.conducted")}
          value={String(total)}
          icon={CalendarDays}
        />
        <StatCard
          label={t("attendance.student.attended")}
          value={String(attended)}
          icon={CalendarCheck}
          tone="mint"
        />
      </div>

      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="mb-4 text-base font-semibold text-ink">
          {t("attendance.student.ledgerTitle")}
        </h2>
        {total === 0 ? (
          <p className="py-8 text-center text-sm text-muted">
            {t("attendance.student.noData")}
          </p>
        ) : (
          <AttendanceCalendar logs={logs} />
        )}
      </section>
    </div>
  );
}

type DayInfo = { present: number; absent: number; late: number };

function AttendanceCalendar({ logs }: { logs: Log[] }) {
  const t = useT();
  const { locale } = useLocale();

  // Aggregate logs per day.
  const byDay = useMemo(() => {
    const map = new Map<string, DayInfo>();
    for (const l of logs) {
      const info = map.get(l.date) ?? { present: 0, absent: 0, late: 0 };
      info[l.status] += 1;
      map.set(l.date, info);
    }
    return map;
  }, [logs]);

  // Default the view to the most recent month that has data.
  const lastDate = logs.length ? logs[logs.length - 1].date : null;
  const initial = lastDate ? new Date(lastDate + "T00:00:00") : new Date();
  const [view, setView] = useState({
    year: initial.getFullYear(),
    month: initial.getMonth(),
  });

  const monthLabel = useMemo(
    () =>
      new Date(view.year, view.month, 1).toLocaleDateString(locale, {
        month: "long",
        year: "numeric",
      }),
    [view, locale],
  );

  const weekdayLabels = useMemo(() => {
    // Build Sun..Sat short labels from a known week.
    const base = new Date(2024, 0, 7); // a Sunday
    return Array.from({ length: 7 }, (_, i) =>
      new Date(base.getFullYear(), base.getMonth(), base.getDate() + i)
        .toLocaleDateString(locale, { weekday: "short" }),
    );
  }, [locale]);

  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells: (number | null)[] = [
    ...Array.from({ length: firstWeekday }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  const shift = (delta: number) =>
    setView((v) => {
      const d = new Date(v.year, v.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => shift(-1)}
          aria-label={t("attendance.student.prevMonth")}
          className="inline-flex size-9 items-center justify-center rounded-md border border-line text-ink hover:bg-lavender"
        >
          <ChevronLeft className="size-4" />
        </button>
        <span className="text-sm font-medium capitalize text-ink tabular-nums">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => shift(1)}
          aria-label={t("attendance.student.nextMonth")}
          className="inline-flex size-9 items-center justify-center rounded-md border border-line text-ink hover:bg-lavender"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {weekdayLabels.map((w, i) => (
          <div key={i} className="py-1 text-xs font-medium capitalize text-muted">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={`b${i}`} />;
          const key = `${view.year}-${pad(view.month + 1)}-${pad(day)}`;
          const info = byDay.get(key);
          let tone = "bg-canvas text-muted";
          if (info) {
            // Severity priority: any absence > any lateness > all present.
            tone =
              info.absent > 0
                ? "bg-lavender font-semibold text-primary"
                : info.late > 0
                  ? "bg-warning/20 font-semibold text-warning"
                  : "bg-mint font-semibold text-teal";
          }
          const title = info
            ? `${t("attendance.present")}: ${info.present} · ${t("attendance.absent")}: ${info.absent} · ${t("attendance.late")}: ${info.late}`
            : undefined;
          return (
            <div
              key={key}
              title={title}
              className={`flex aspect-square items-center justify-center rounded-md text-sm tabular-nums ${tone}`}
            >
              {day}
            </div>
          );
        })}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-mint" />
          {t("attendance.student.legendPresent")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-lavender" />
          {t("attendance.student.legendAbsent")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm bg-warning/40" />
          {t("attendance.student.legendLate")}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-line bg-canvas" />
          {t("attendance.student.legendNone")}
        </span>
      </div>
    </div>
  );
}
