"use server";

// Phase 9 — Attendance server actions.
//
// Both entry points are gated by requireCapability("attendance") — a strict
// server-side check that 403s (admin, principal, faculty, staff). Students never
// reach these.
//
//   - fetchStudentsAction:     dynamic roster for a course/class/(batch)
//   - submitAttendanceAction:  bulk-write present/absent rows for one session
//
// Re-submitting the same session (date + class + subject + batch) is idempotent:
// the prior rows for that exact scope are cleared first, so a teacher can fix a
// mistake without creating duplicates (the ledger stays a single source truth).
//
// DATE RULES (enforcement matrix: "attendance edits of past -> admin only").
// Because a re-submit DELETES the existing rows for that scope, writing to a
// past date is an edit of history, not a fresh mark. So:
//   - today          -> anyone with `attendance`
//   - any past date  -> `attendanceBackdate` (ADMIN ONLY)
//   - any future date-> rejected for everyone; a class that has not happened
//                       yet cannot have attendance.
// The date is compared server-side against the server clock — a client that
// lies about `date` gets rejected, it does not get a bypass.

import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { attendanceLogs, users } from "@/db/schema";
import { requireCapability } from "@/lib/auth";
import { can, type Role } from "@/lib/auth/permissions";
import { todayIso } from "@/lib/dates";
import { logServerError } from "@/lib/errors";
import { parseInput, type FieldErrors } from "@/lib/validation/core";
import {
  rosterFilterSchema,
  submitAttendanceSchema,
} from "@/lib/validation/schemas";

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

  // An incomplete or malformed filter returns an empty roster rather than an
  // error — this fires on every scope change as the form is filled in, so a
  // half-chosen scope is a normal state, not a failure.
  const parsed = parseInput(rosterFilterSchema, filters);
  if (!parsed.ok) return [];
  const { course, className, practicalBatch } = parsed.data;

  const conds = [
    eq(users.role, "student"),
    eq(users.status, "active"),
    eq(users.course, course),
    eq(users.className, className),
  ];
  // Empty batch = Theory (whole class); a batch value narrows to that batch.
  if (practicalBatch) conds.push(eq(users.practicalBatch, practicalBatch));

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
  | {
      ok: false;
      error:
        | "empty"
        | "invalid"
        | "validation"
        | "pastDateForbidden"
        | "futureDate";
      fieldErrors?: FieldErrors;
    };

export async function submitAttendanceAction(
  input: SubmitAttendanceInput,
): Promise<SubmitResult> {
  const marker = await requireCapability("attendance");

  // Structural validation: a real calendar date, bounded class/subject/batch
  // strings, a non-empty capped records array whose every entry is a positive
  // integer id plus a permitted status, and no unknown keys anywhere.
  const parsed = parseInput(submitAttendanceSchema, input);
  if (!parsed.ok) {
    // An empty roster is a distinct, expected case the UI words differently.
    if (Array.isArray(input?.records) && input.records.length === 0) {
      return { ok: false, error: "empty" };
    }
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const { date, records } = parsed.data;
  // Preserved as nullable: null means "theory / no batch" in the ledger, and the
  // delete-scope below keys off that distinction.
  const subject = parsed.data.subject || null;
  const className = parsed.data.className || null;
  const batch = parsed.data.practicalBatch || null;

  // --- Date window (see DATE RULES in the file header). Zero-padded ISO dates
  // compare correctly as strings, so no Date parsing is needed. ---
  const today = todayIso();
  if (date > today) return { ok: false, error: "futureDate" };
  if (date < today && !can(marker.role as Role, "attendanceBackdate")) {
    return { ok: false, error: "pastDateForbidden" };
  }

  // --- Validate every target id. `records[].studentId` is caller-supplied, so
  // without this a marker could write attendance rows against arbitrary user
  // ids (staff, admins, or ids that do not exist). Only ACTIVE students may be
  // marked, and the whole submission is rejected if any id fails — a partial
  // write would leave a session silently missing people. ---
  const targetIds = [...new Set(records.map((r) => r.studentId))];
  if (targetIds.length !== records.length) {
    // A duplicate id in one submission is malformed input.
    return { ok: false, error: "invalid" };
  }

  const valid = await db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        inArray(users.id, targetIds),
        eq(users.role, "student"),
        eq(users.status, "active"),
      ),
    );
  if (valid.length !== targetIds.length) {
    return { ok: false, error: "invalid" };
  }

  // (Status enum membership is enforced by submitAttendanceSchema above.)

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

  try {
    await db.insert(attendanceLogs).values(
      records.map((r) => ({
        studentId: r.studentId,
        date,
        status: r.status,
        subject,
        className,
        practicalBatch: batch,
        markedBy: marker.id,
      })),
    );
  } catch (err) {
    // Driver text names tables and columns — log it, return a generic code.
    logServerError("submitAttendanceAction", err, {
      date,
      className,
      count: records.length,
    });
    return { ok: false, error: "invalid" };
  }

  revalidatePath("/teacher/attendance");
  revalidatePath("/student/attendance");
  return { ok: true, count: records.length };
}
