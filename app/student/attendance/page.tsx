// Student attendance view (Phase 9).
//
// Server component: pulls this student's full attendance ledger, computes the
// headline stats, and passes everything to the client view (StatCards +
// calendar). Each log row is one class instance, so attendance % = present/total.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceLogs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { StudentAttendanceView } from "./StudentAttendanceView";

export default async function StudentAttendancePage() {
  const user = await requireUser();

  const logs = await db
    .select({
      date: attendanceLogs.date,
      status: attendanceLogs.status,
      subject: attendanceLogs.subject,
    })
    .from(attendanceLogs)
    .where(eq(attendanceLogs.studentId, user.id))
    .orderBy(asc(attendanceLogs.date));

  const total = logs.length;
  const attended = logs.filter((l) => l.status === "present").length;
  const pct = total ? Math.round((attended / total) * 100) : 0;

  return (
    <StudentAttendanceView
      logs={logs}
      total={total}
      attended={attended}
      pct={pct}
    />
  );
}
