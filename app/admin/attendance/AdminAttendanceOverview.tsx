"use client";

// Admin attendance monitor: stat cards + a per-student table sorted worst-first
// so at-risk students surface immediately. Pure client view (search + class
// filter) over server-aggregated rows — no mutations here.

import { useMemo, useState } from "react";
import { CalendarCheck, Percent, TrendingDown } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";

export const AT_RISK_THRESHOLD = 75;

export type AttendanceRow = {
  id: number;
  fullName: string;
  rollNo: string | null;
  className: string | null;
  conducted: number;
  attended: number;
  rate: number; // 0–100, already rounded
};

export function AdminAttendanceOverview({
  rows,
  overallRate,
  sessions,
  atRisk,
}: {
  rows: AttendanceRow[];
  overallRate: number;
  sessions: number;
  atRisk: number;
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const classes = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) if (r.className) set.add(r.className);
    return [...set].sort();
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (classFilter && r.className !== classFilter) return false;
        if (!q) return true;
        return (
          r.fullName.toLowerCase().includes(q) ||
          (r.rollNo?.toLowerCase().includes(q) ?? false) ||
          (r.className?.toLowerCase().includes(q) ?? false)
        );
      })
      // Worst attendance first — that's who needs attention.
      .sort((a, b) => a.rate - b.rate || b.conducted - a.conducted);
  }, [rows, search, classFilter]);

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t("attendanceOverview.statOverallRate")}
          value={`${overallRate}%`}
          icon={Percent}
          tone="mint"
        />
        <StatCard
          label={t("attendanceOverview.statSessions")}
          value={String(sessions)}
          icon={CalendarCheck}
        />
        <StatCard
          label={t("attendanceOverview.statAtRisk", {
            threshold: AT_RISK_THRESHOLD,
          })}
          value={String(atRisk)}
          icon={TrendingDown}
        />
      </div>

      {rows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
          {t("attendanceOverview.empty")}
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("attendanceOverview.searchPlaceholder")}
              className="w-full max-w-xs rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-teal"
            />
            <select
              value={classFilter}
              onChange={(e) => setClassFilter(e.target.value)}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
            >
              <option value="">{t("attendanceOverview.allClasses")}</option>
              {classes.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <span className="ml-auto text-sm text-muted">
              {t("attendanceOverview.showing", {
                count: visible.length,
                total: rows.length,
              })}
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-line bg-surface shadow-sm">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">
                    {t("attendanceOverview.colRollNo")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("attendanceOverview.colName")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("attendanceOverview.colClass")}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t("attendanceOverview.colConducted")}
                  </th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t("attendanceOverview.colAttended")}
                  </th>
                  <th className="px-4 py-3 font-medium">
                    {t("attendanceOverview.colRate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {visible.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-muted"
                    >
                      {t("attendanceOverview.noResults")}
                    </td>
                  </tr>
                ) : (
                  visible.map((r) => {
                    const low = r.rate < AT_RISK_THRESHOLD;
                    return (
                      <tr
                        key={r.id}
                        className="border-b border-line last:border-0"
                      >
                        <td className="px-4 py-3 tabular-nums text-muted">
                          {r.rollNo ?? "—"}
                        </td>
                        <td className="px-4 py-3 font-medium text-ink">
                          {r.fullName}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {r.className ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">
                          {r.conducted}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-ink">
                          {r.attended}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 w-24 overflow-hidden rounded-full bg-canvas">
                              <div
                                className={`h-full rounded-full ${
                                  low ? "bg-warning" : "bg-teal"
                                }`}
                                style={{ width: `${r.rate}%` }}
                              />
                            </div>
                            <span
                              className={`tabular-nums ${
                                low ? "font-semibold text-warning" : "text-ink"
                              }`}
                            >
                              {r.rate}%
                            </span>
                            {low && (
                              <span className="rounded-full bg-lavender px-2 py-0.5 text-xs font-medium text-warning">
                                {t("attendanceOverview.lowBadge")}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
