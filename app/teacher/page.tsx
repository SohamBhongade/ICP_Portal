// Teacher overview (Phase 12) — live metrics.
//
// "Classes conducted this week" = distinct attendance sessions (date · class ·
// subject · batch) this teacher recorded within the current ISO week.

import { and, eq, gte, lte } from "drizzle-orm";
import { db } from "@/db";
import { attendanceLogs } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { weekBounds } from "@/lib/dates";
import { TeacherOverview } from "./TeacherOverview";

export default async function TeacherDashboardPage() {
  const teacher = await requireRole("teacher", "admin");
  const { start, end } = weekBounds();

  const sessions = await db
    .select({
      date: attendanceLogs.date,
      className: attendanceLogs.className,
      subject: attendanceLogs.subject,
      practicalBatch: attendanceLogs.practicalBatch,
    })
    .from(attendanceLogs)
    .where(
      and(
        eq(attendanceLogs.markedBy, teacher.id),
        gte(attendanceLogs.date, start),
        lte(attendanceLogs.date, end),
      ),
    );

  const distinct = new Set(
    sessions.map(
      (s) => `${s.date}|${s.className}|${s.subject}|${s.practicalBatch}`,
    ),
  );

  return <TeacherOverview classesThisWeek={distinct.size} />;
}
