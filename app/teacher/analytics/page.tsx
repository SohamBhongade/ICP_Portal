// Teacher Analytics (Phase 9 tail) — attendance insights with charts.
//
// Server component: aggregates the attendance ledger by class and by date in
// SQL, plus a few headline counts, then hands plain arrays to the client charts
// (recharts). Scope is school-wide so the charts are useful even before this
// teacher has recorded much; a personal "recorded by you" stat keeps it grounded.

import { and, asc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendanceLogs, users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import {
  TeacherAnalytics,
  type ClassRate,
  type TrendPoint,
} from "./TeacherAnalytics";

const sessionKey = sql`${attendanceLogs.date} || '|' || coalesce(${attendanceLogs.className}, '') || '|' || coalesce(${attendanceLogs.subject}, '') || '|' || coalesce(${attendanceLogs.practicalBatch}, '')`;
// 'late' counts as attended — a late student was still present.
const presentSum = sql<number>`coalesce(sum(case when ${attendanceLogs.status} in ('present', 'late') then 1 else 0 end), 0)`;

export default async function TeacherAnalyticsPage() {
  const me = await requireRole("teacher", "admin");

  const [byClass, byDate, totalSessions, yourSessions, activeStudents] =
    await Promise.all([
      db
        .select({
          className: attendanceLogs.className,
          conducted: sql<number>`count(*)`,
          attended: presentSum,
        })
        .from(attendanceLogs)
        .groupBy(attendanceLogs.className),
      db
        .select({
          date: attendanceLogs.date,
          conducted: sql<number>`count(*)`,
          attended: presentSum,
        })
        .from(attendanceLogs)
        .groupBy(attendanceLogs.date)
        .orderBy(asc(attendanceLogs.date)),
      db
        .select({ c: sql<number>`count(distinct ${sessionKey})` })
        .from(attendanceLogs),
      db
        .select({ c: sql<number>`count(distinct ${sessionKey})` })
        .from(attendanceLogs)
        .where(eq(attendanceLogs.markedBy, me.id)),
      db
        .select({ c: sql<number>`count(*)` })
        .from(users)
        .where(and(eq(users.role, "student"), eq(users.status, "active"))),
    ]);

  const rate = (attended: number, conducted: number) =>
    conducted > 0 ? Math.round((attended / conducted) * 100) : 0;

  // Overall totals fall out of the by-class aggregation.
  let totalConducted = 0;
  let totalAttended = 0;
  const classRates: ClassRate[] = [];
  for (const c of byClass) {
    const conducted = Number(c.conducted);
    const attended = Number(c.attended);
    totalConducted += conducted;
    totalAttended += attended;
    if (!c.className) continue; // un-named bucket → not chartable
    classRates.push({
      className: c.className,
      rate: rate(attended, conducted),
      conducted,
    });
  }
  classRates.sort((a, b) => b.rate - a.rate);

  // Trend: last 12 recorded dates, oldest → newest.
  const trend: TrendPoint[] = byDate
    .slice(-12)
    .map((d) => ({ date: d.date, rate: rate(Number(d.attended), Number(d.conducted)) }));

  return (
    <TeacherAnalytics
      overallRate={rate(totalAttended, totalConducted)}
      totalSessions={Number(totalSessions[0]?.c ?? 0)}
      yourSessions={Number(yourSessions[0]?.c ?? 0)}
      activeStudents={Number(activeStudents[0]?.c ?? 0)}
      classRates={classRates}
      trend={trend}
    />
  );
}
