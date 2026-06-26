"use server";

// Phase 8 — Onboarding server actions.
//
// Two entry points, both ADMIN-ONLY (re-verified server-side on every call —
// never trust the client):
//   - createUserAction:         manual single student / staff creation
//   - bulkImportStudentsAction: CSV batch student creation
//
// Business rules (per Phase 8 spec):
//   - New accounts are created with status='active' (immediately usable).
//   - A temporary password is auto-hashed via bcrypt so the account can log in
//     on day one. Pattern: 'Icp@' + <roll number> for students, and
//     'Icp@' + <email local-part> for staff (who have no roll number).
//   - studentId / email both carry UNIQUE constraints; a clash surfaces as a
//     "duplicate" error rather than throwing.

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export type OnboardRole = "student" | "teacher" | "admin";

/** Manual single-create payload (drawer form). */
export type CreateUserInput = {
  role: OnboardRole;
  fullName: string;
  email?: string;
  phone?: string;
  studentId?: string; // roll number — students only
  course?: string;
  className?: string;
  practicalBatch?: string;
};

/** One already-column-mapped CSV row (always a student). */
export type CsvStudentRow = {
  fullName: string;
  studentId: string;
  email?: string;
  phone?: string;
  course?: string;
  className?: string;
  practicalBatch?: string;
};

/** Stable error codes — the client translates these via onboarding.errors.<code>. */
export type ActionError =
  | "forbidden"
  | "missingName"
  | "missingRollNo"
  | "missingEmail"
  | "invalidEmail"
  | "duplicate"
  | "unknown";

export type CreateUserResult =
  | { ok: true; id: number }
  | { ok: false; error: ActionError };

export type BulkImportResult =
  | { ok: false; error: ActionError }
  | {
      ok: true;
      created: number;
      failed: { row: number; reason: ActionError }[];
    };

// Pragmatic email shape check (mirrors the client-side check).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Returns the admin user, or null if the caller is not an admin. */
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

/** Temporary first-login password. See file header for the pattern. */
function tempPassword(role: OnboardRole, studentId?: string, email?: string) {
  const base =
    role === "student"
      ? (studentId ?? "")
      : (email?.split("@")[0] ?? "");
  return `Icp@${base}`;
}

export async function createUserAction(
  input: CreateUserInput,
): Promise<CreateUserResult> {
  if (!(await assertAdmin())) return { ok: false, error: "forbidden" };

  const role = input.role;
  const fullName = input.fullName?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() || undefined;
  const phone = input.phone?.trim() || undefined;
  const studentId = input.studentId?.trim() || undefined;

  if (!fullName) return { ok: false, error: "missingName" };

  if (role === "student") {
    if (!studentId) return { ok: false, error: "missingRollNo" };
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "invalidEmail" };
    }
  } else {
    // Staff (teacher/admin) log in by email, so it is mandatory.
    if (!email) return { ok: false, error: "missingEmail" };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "invalidEmail" };
  }

  const passwordHash = await bcrypt.hash(
    tempPassword(role, studentId, email),
    10,
  );

  const isStudent = role === "student";
  const res = await db
    .insert(users)
    .values({
      fullName,
      email,
      phone,
      studentId: isStudent ? studentId : undefined,
      role,
      status: "active",
      course: isStudent ? input.course?.trim() || undefined : undefined,
      className: isStudent ? input.className?.trim() || undefined : undefined,
      practicalBatch: isStudent
        ? input.practicalBatch?.trim() || undefined
        : undefined,
      passwordHash,
    })
    .onConflictDoNothing()
    .returning({ id: users.id });

  // No row back => a UNIQUE constraint (studentId or email) already exists.
  if (res.length === 0) return { ok: false, error: "duplicate" };

  revalidatePath("/admin/users");
  return { ok: true, id: res[0].id };
}

export async function bulkImportStudentsAction(
  rows: CsvStudentRow[],
): Promise<BulkImportResult> {
  if (!(await assertAdmin())) return { ok: false, error: "forbidden" };

  let created = 0;
  const failed: { row: number; reason: ActionError }[] = [];

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const fullName = r.fullName?.trim() ?? "";
    const studentId = r.studentId?.trim() ?? "";
    const email = r.email?.trim().toLowerCase() || undefined;

    // Row numbers are 1-based for human-friendly reporting.
    if (!fullName) {
      failed.push({ row: i + 1, reason: "missingName" });
      continue;
    }
    if (!studentId) {
      failed.push({ row: i + 1, reason: "missingRollNo" });
      continue;
    }
    if (email && !EMAIL_RE.test(email)) {
      failed.push({ row: i + 1, reason: "invalidEmail" });
      continue;
    }

    try {
      const passwordHash = await bcrypt.hash(
        tempPassword("student", studentId, email),
        10,
      );
      const res = await db
        .insert(users)
        .values({
          fullName,
          studentId,
          email,
          phone: r.phone?.trim() || undefined,
          role: "student",
          status: "active",
          course: r.course?.trim() || undefined,
          className: r.className?.trim() || undefined,
          practicalBatch: r.practicalBatch?.trim() || undefined,
          passwordHash,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });

      if (res.length === 0) failed.push({ row: i + 1, reason: "duplicate" });
      else created++;
    } catch {
      failed.push({ row: i + 1, reason: "unknown" });
    }
  }

  if (created > 0) revalidatePath("/admin/users");
  return { ok: true, created, failed };
}

// ---------- Account request review (admin-only) ----------
//
// A self-service signup arrives as a status='pending' student row (see
// requestAccountAction). The admin may correct typos in the same payload, then:
//   - approveRequestAction: apply edits + flip status='active'
//   - rejectRequestAction:  flip status='rejected'
// Both only touch rows that are STILL pending, so a double-click or stale page
// can never re-open a decided request.

export type ApproveRequestInput = {
  id: number;
  fullName: string;
  studentId: string;
  email?: string;
  phone?: string;
  course?: string;
  className?: string;
  practicalBatch?: string;
};

export type RequestResult =
  | { ok: true }
  | { ok: false; error: ActionError };

function revalidateRequestViews() {
  revalidatePath("/admin/requests");
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

export async function approveRequestAction(
  input: ApproveRequestInput,
): Promise<RequestResult> {
  if (!(await assertAdmin())) return { ok: false, error: "forbidden" };

  const fullName = input.fullName?.trim() ?? "";
  const studentId = input.studentId?.trim() || undefined;
  const email = input.email?.trim().toLowerCase() || undefined;

  if (!fullName) return { ok: false, error: "missingName" };
  if (!studentId) return { ok: false, error: "missingRollNo" };
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "invalidEmail" };
  }

  try {
    const res = await db
      .update(users)
      .set({
        fullName,
        studentId,
        email,
        phone: input.phone?.trim() || null,
        course: input.course?.trim() || null,
        className: input.className?.trim() || null,
        practicalBatch: input.practicalBatch?.trim() || null,
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, input.id), eq(users.status, "pending")))
      .returning({ id: users.id });

    if (res.length === 0) return { ok: false, error: "unknown" };
  } catch {
    // A UNIQUE clash on the edited studentId/email surfaces here.
    return { ok: false, error: "duplicate" };
  }

  revalidateRequestViews();
  return { ok: true };
}

export async function rejectRequestAction(
  id: number,
): Promise<RequestResult> {
  if (!(await assertAdmin())) return { ok: false, error: "forbidden" };

  const res = await db
    .update(users)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.status, "pending")))
    .returning({ id: users.id });

  if (res.length === 0) return { ok: false, error: "unknown" };

  revalidateRequestViews();
  return { ok: true };
}
