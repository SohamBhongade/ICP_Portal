// Admin Attendance Overview (Phase 9 tail) — read-only, cross-class monitoring.
//
// Server component: aggregates the attendance ledger per student (conducted vs.
// attended) in SQL, counts distinct sessions, then hands plain rows to the
// client view for search / class-filter / worst-first sorting. The threshold
// below decides which students surface as "at risk".

import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { attendanceLogs, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth";
import {
  AdminAttendanceOverview,
  AT_RISK_THRESHOLD,
  type AttendanceRow,
} from "./AdminAttendanceOverview";

export default async function AdminAttendancePage() {
  // Read-only, cross-class monitoring is a management view (admin + principal).
  await requireCapability("settings");
  const [agg, students, sessionRow] = await Promise.all([
    db
      .select({
        studentId: attendanceLogs.studentId,
        conducted: sql<number>`count(*)`,
        // 'late' counts as attended — a late student was still present.
        attended: sql<number>`coalesce(sum(case when ${attendanceLogs.status} in ('present', 'late') then 1 else 0 end), 0)`,
      })
      .from(attendanceLogs)
      .groupBy(attendanceLogs.studentId),
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        rollNo: users.studentId,
        className: users.className,
      })
      .from(users)
      .where(eq(users.role, "student")),
    db
      .select({
        sessions: sql<number>`count(distinct ${attendanceLogs.date} || '|' || coalesce(${attendanceLogs.className}, '') || '|' || coalesce(${attendanceLogs.subject}, '') || '|' || coalesce(${attendanceLogs.practicalBatch}, ''))`,
      })
      .from(attendanceLogs),
  ]);

  const byId = new Map(students.map((s) => [s.id, s]));

  let totalConducted = 0;
  let totalAttended = 0;
  const rows: AttendanceRow[] = [];
  for (const a of agg) {
    const u = byId.get(a.studentId);
    if (!u) continue; // student row deleted — skip orphaned logs
    const conducted = Number(a.conducted);
    const attended = Number(a.attended);
    totalConducted += conducted;
    totalAttended += attended;
    rows.push({
      id: a.studentId,
      fullName: u.fullName,
      rollNo: u.rollNo,
      className: u.className,
      conducted,
      attended,
      rate: conducted > 0 ? Math.round((attended / conducted) * 100) : 0,
    });
  }

  const overallRate =
    totalConducted > 0
      ? Math.round((totalAttended / totalConducted) * 100)
      : 0;
  const atRisk = rows.filter((r) => r.rate < AT_RISK_THRESHOLD).length;

  return (
    <AdminAttendanceOverview
      rows={rows}
      overallRate={overallRate}
      sessions={Number(sessionRow[0]?.sessions ?? 0)}
      atRisk={atRisk}
    />
  );
}
