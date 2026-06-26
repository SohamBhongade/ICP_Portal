"use client";

// Teacher analytics dashboard: headline StatCards + two recharts visualizations
// (attendance rate by class, attendance trend over recent sessions). Chart
// colors reference the raw :root palette variables so they track the theme.

import {
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { BarChart3, CalendarCheck, Percent, Users } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT, useLocale } from "@/components/i18n/LanguageProvider";

export type ClassRate = {
  className: string;
  rate: number;
  conducted: number;
};

export type TrendPoint = {
  date: string; // 'YYYY-MM-DD'
  rate: number;
};

export function TeacherAnalytics({
  overallRate,
  totalSessions,
  yourSessions,
  activeStudents,
  classRates,
  trend,
}: {
  overallRate: number;
  totalSessions: number;
  yourSessions: number;
  activeStudents: number;
  classRates: ClassRate[];
  trend: TrendPoint[];
}) {
  const t = useT();
  const { locale } = useLocale();

  const shortDate = (iso: string) => {
    const d = new Date(`${iso}T00:00:00`);
    return d.toLocaleDateString(locale, { day: "numeric", month: "short" });
  };

  const tickStyle = { fontSize: 12, fill: "var(--muted)" } as const;
  const fmtPct = (value: number | string) => `${value}%`;

  if (totalSessions === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <Header t={t} />
        <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
          {t("analytics.empty")}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <Header t={t} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t("analytics.statOverallRate")}
          value={`${overallRate}%`}
          icon={Percent}
          tone="mint"
        />
        <StatCard
          label={t("analytics.statSessions")}
          value={String(totalSessions)}
          icon={CalendarCheck}
        />
        <StatCard
          label={t("analytics.statYourSessions")}
          value={String(yourSessions)}
          icon={BarChart3}
        />
        <StatCard
          label={t("analytics.statStudents")}
          value={String(activeStudents)}
          icon={Users}
        />
      </div>

      <section className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-ink">
          {t("analytics.byClassTitle")}
        </h2>
        {classRates.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            {t("analytics.byClassEmpty")}
          </p>
        ) : (
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={classRates}
                margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis
                  dataKey="className"
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={fmtPct}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                />
                <Tooltip
                  formatter={(value) => `${value}%`}
                  cursor={{ fill: "var(--lavender)" }}
                  labelStyle={{ color: "var(--ink)" }}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    fontSize: 12,
                  }}
                />
                <Bar
                  dataKey="rate"
                  name={t("analytics.rate")}
                  fill="var(--chart-present)"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={64}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6">
        <h2 className="text-sm font-semibold text-ink">
          {t("analytics.trendTitle")}
        </h2>
        <p className="mt-1 text-xs text-muted">
          {t("analytics.trendSubtitle")}
        </p>
        {trend.length < 2 ? (
          <p className="py-10 text-center text-sm text-muted">
            {t("analytics.trendEmpty")}
          </p>
        ) : (
          <div className="mt-4 h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={trend}
                margin={{ top: 8, right: 8, bottom: 8, left: -16 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
                <XAxis
                  dataKey="date"
                  tickFormatter={shortDate}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                />
                <YAxis
                  domain={[0, 100]}
                  tickFormatter={fmtPct}
                  tick={tickStyle}
                  tickLine={false}
                  axisLine={{ stroke: "var(--line)" }}
                />
                <Tooltip
                  formatter={(value) => `${value}%`}
                  labelFormatter={(label) => shortDate(String(label))}
                  labelStyle={{ color: "var(--ink)" }}
                  contentStyle={{
                    borderRadius: 8,
                    border: "1px solid var(--line)",
                    fontSize: 12,
                  }}
                />
                <Line
                  type="monotone"
                  dataKey="rate"
                  name={t("analytics.rate")}
                  stroke="var(--primary)"
                  strokeWidth={2}
                  dot={{ r: 3, fill: "var(--primary)" }}
                  activeDot={{ r: 5 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>
    </div>
  );
}

function Header({ t }: { t: (key: string) => string }) {
  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{t("analytics.title")}</h1>
      <p className="mt-1 text-sm text-muted">{t("analytics.subtitle")}</p>
    </div>
  );
}
