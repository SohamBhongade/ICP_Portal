"use server";

// Phase 9 — Attendance server actions.
//
// Both entry points are gated by requireCapability("attendance") — a strict
// server-side check (admin, principle, faculty, staff). Students never reach
// these.
//
//   - fetchStudentsAction:     dynamic roster for a course/class/(batch)
//   - submitAttendanceAction:  bulk-write present/absent rows for one session
//
// Re-submitting the same session (date + class + subject + batch) is idempotent:
// the prior rows for that exact scope are cleared first, so a teacher can fix a
// mistake without creating duplicates (the ledger stays a single source truth).

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attendanceLogs, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth";

export type RosterStudent = {
  id: number;
  fullName: string;
  studentId: string | null;
};

export type AttendanceStatus = "present" | "absent" | "late";

export async function fetchStudentsAction(filters: {
  course: string;
  className: string;
  practicalBatch?: string;
}): Promise<RosterStudent[]> {
  await requireCapability("attendance");

  const course = filters.course?.trim();
  const className = filters.className?.trim();
  if (!course || !className) return [];

  const conds = [
    eq(users.role, "student"),
    eq(users.status, "active"),
    eq(users.course, course),
    eq(users.className, className),
  ];
  // Empty batch = Theory (whole class); a batch value narrows to that batch.
  const batch = filters.practicalBatch?.trim();
  if (batch) conds.push(eq(users.practicalBatch, batch));

  return db
    .select({
      id: users.id,
      fullName: users.fullName,
      studentId: users.studentId,
    })
    .from(users)
    .where(and(...conds))
    .orderBy(asc(users.fullName));
}

export type SubmitAttendanceInput = {
  date: string; // 'YYYY-MM-DD'
  className: string;
  subject: string;
  practicalBatch?: string; // empty/undefined = Theory
  records: { studentId: number; status: AttendanceStatus }[];
};

export type SubmitResult =
  | { ok: true; count: number }
  | { ok: false; error: "empty" | "invalid" };

export async function submitAttendanceAction(
  input: SubmitAttendanceInput,
): Promise<SubmitResult> {
  const marker = await requireCapability("attendance");

  const date = input.date?.trim();
  const subject = input.subject?.trim() || null;
  const className = input.className?.trim() || null;
  const batch = input.practicalBatch?.trim() || null;

  if (!date) return { ok: false, error: "invalid" };
  if (!input.records || input.records.length === 0) {
    return { ok: false, error: "empty" };
  }

  // Clear any existing rows for this exact session scope (idempotent re-submit).
  await db.delete(attendanceLogs).where(
    and(
      eq(attendanceLogs.date, date),
      subject
        ? eq(attendanceLogs.subject, subject)
        : isNull(attendanceLogs.subject),
      className
        ? eq(attendanceLogs.className, className)
        : isNull(attendanceLogs.className),
      batch
        ? eq(attendanceLogs.practicalBatch, batch)
        : isNull(attendanceLogs.practicalBatch),
    ),
  );

  await db.insert(attendanceLogs).values(
    input.records.map((r) => ({
      studentId: r.studentId,
      date,
      status: r.status,
      subject,
      className,
      practicalBatch: batch,
      markedBy: marker.id,
    })),
  );

  revalidatePath("/teacher/attendance");
  revalidatePath("/student/attendance");
  return { ok: true, count: input.records.length };
}
