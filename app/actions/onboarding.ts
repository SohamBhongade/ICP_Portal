"use server";

// Phase 8 — Onboarding server actions.
//
// Every entry point re-verifies its capability SERVER-SIDE on each call — never
// trust the client, and never rely on a hidden button:
//   - createUserAction:         `createUsers` — ADMIN ONLY
//     (the CSV/XLSX bulk path now lives in app/actions/import.ts, same gate)
//   - updateUserAction:         `manageUsers` (admin / principal / office admin)
//   - approve/rejectRequest:    `approveRequests` (admin / principal)
//   - deleteUserAction:         `deleteUsers` (admin only)
//
// Direct account creation is deliberately the narrowest gate of the lot: minting
// an account outright bypasses the review queue entirely, so only an admin may
// do it. Everyone else routes people through /request-account -> /admin/requests.
//
// Business rules:
//   - Admin-created accounts are status='active' (immediately usable).
//   - A temporary password is auto-hashed via bcrypt so the account can log in
//     on day one. Pattern: 'Icp@' + <roll number> for students, and
//     'Icp@' + <email local-part> for staff (who have no roll number).
//   - studentId / email both carry UNIQUE constraints; a clash surfaces as a
//     "duplicate" error rather than throwing.

import bcrypt from "bcryptjs";
import { and, eq, or } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import {
  attendanceLogs,
  feeLedgers,
  supportTickets,
  users,
} from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { canAssignRole, type Role } from "@/lib/auth/permissions";
import { extractYear, normalizeCourse, resolveCourse } from "@/lib/courses";
import { logServerError } from "@/lib/errors";
import { RULES, checkRateLimit } from "@/lib/rate-limit";
import { parseInput, type FieldErrors } from "@/lib/validation/core";
import {
  approveRequestSchema,
  createUserSchema,
  idSchema,
  updateUserSchema,
} from "@/lib/validation/schemas";

/**
 * Derive the canonical course + academic year for a student from the raw course
 * cell (year may be embedded, e.g. "1st year B.Pharm") with the class cell as a
 * year fallback. Returns `invalid` only when a non-empty course cell contains no
 * course-like text at all (mirrors resolveCourse's contract).
 */
function resolveStudentCourseYear(
  courseRaw: string | undefined,
  classRaw: string | undefined,
): { ok: true; course?: string; year?: number } | { ok: false } {
  const res = resolveCourse(courseRaw);
  if (res.status === "invalid") return { ok: false };
  const norm = normalizeCourse(courseRaw);
  const year = norm.year ?? extractYear(classRaw ?? "").year ?? undefined;
  return { ok: true, course: norm.course ?? undefined, year };
}

// A created account can be any role — which ones a given actor may actually
// assign is enforced by canAssignRole() below (anti-escalation).
export type OnboardRole = Role;

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

/** Stable error codes — the client translates these via onboarding.errors.<code>. */
export type ActionError =
  | "forbidden"
  | "validation"
  | "rateLimited"
  | "missingName"
  | "missingRollNo"
  | "missingEmail"
  | "invalidEmail"
  | "invalidCourse"
  | "weakPassword"
  | "duplicate"
  | "unknown";

export type CreateUserResult =
  | { ok: true; id: number }
  | { ok: false; error: ActionError; fieldErrors?: FieldErrors };

// Pragmatic email shape check (mirrors the client-side check).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Returns the caller if they may CREATE a brand-new account outright, else null.
 * ADMIN ONLY (`createUsers`) — this is the authoritative check for every "add
 * user directly" path (manual drawer + CSV import). Hiding the button in the UI
 * is presentation only; this is the gate that actually enforces it.
 */
async function assertCreateUsers() {
  return currentUserWithCapability("createUsers");
}

/** Returns the caller if they may EDIT existing users, else null. */
async function assertManageUsers() {
  return currentUserWithCapability("manageUsers");
}

/**
 * Returns the caller if they may APPROVE/REJECT account requests, else null.
 * This is a stricter gate than manageUsers — Admin + Principal only. Office
 * Admin (who holds manageUsers) is intentionally blocked from approvals.
 */
async function assertApproveRequests() {
  return currentUserWithCapability("approveRequests");
}

/**
 * bcrypt cost factor for every password this app writes. 12 is the project
 * floor — db/create-admin.ts declares the same value for the CLI path. NOT
 * exported: a "use server" module may only export async functions.
 */
const BCRYPT_COST = 12;

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
  // ADMIN ONLY — creating an account outright skips the request queue.
  const actor = await assertCreateUsers();
  if (!actor) return { ok: false, error: "forbidden" };

  // Structural validation before any business DB call. Strict mode is doing real
  // work here: without it a crafted payload could carry `status` or
  // `passwordHash` alongside the legitimate fields.
  const parsed = parseInput(createUserSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const data = parsed.data;

  const role = data.role;
  // Anti-escalation: an actor can never mint a role above their own tier.
  if (!canAssignRole(actor.role as Role, role)) {
    return { ok: false, error: "forbidden" };
  }
  const fullName = data.fullName;
  const email = data.email;
  const phone = data.phone;
  const studentId = data.studentId;

  if (!fullName) return { ok: false, error: "missingName" };

  if (role === "student") {
    if (!studentId) return { ok: false, error: "missingRollNo" };
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "invalidEmail" };
    }
  } else {
    // All staff roles log in by email, so it is mandatory.
    if (!email) return { ok: false, error: "missingEmail" };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "invalidEmail" };
  }

  const passwordHash = await bcrypt.hash(
    tempPassword(role, studentId, email),
    BCRYPT_COST,
  );

  const isStudent = role === "student";

  // Normalize the course to its canonical value + academic year before writing.
  // Only students carry a course/year; junk (no course text) is rejected.
  let course: string | undefined;
  let year: number | undefined;
  if (isStudent) {
    const resolved = resolveStudentCourseYear(data.course, data.className);
    if (!resolved.ok) return { ok: false, error: "invalidCourse" };
    course = resolved.course;
    year = resolved.year;
  }

  let res: { id: number }[];
  try {
    res = await db
      .insert(users)
      .values({
        fullName,
        email,
        phone,
        studentId: isStudent ? studentId : undefined,
        role,
        status: "active",
        course,
        year,
        className: isStudent ? data.className : undefined,
        practicalBatch: isStudent ? data.practicalBatch : undefined,
        passwordHash,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });
  } catch (err) {
    logServerError("createUserAction", err, { role });
    return { ok: false, error: "unknown" };
  }

  // No row back => a UNIQUE constraint (studentId or email) already exists.
  if (res.length === 0) return { ok: false, error: "duplicate" };

  revalidatePath("/admin/users");
  return { ok: true, id: res[0].id };
}

// bulkImportStudentsAction was REMOVED in Phase 4.
//
// It accepted an array of rows that the BROWSER had parsed out of a CSV, which
// meant the server never saw the uploaded file and had no way to enforce a size
// limit, a real file-type check, a row cap, a cell-length cap, or CSV formula
// neutralization — every one of those checks lived in code an attacker
// controlled. Anyone could call the action directly with an arbitrary payload.
//
// The import now uploads the FILE and parses it server-side. See
// app/actions/import.ts (parseImportFileAction + importStudentsFileAction) and
// lib/import/parse.ts.

// ---------- Account request review (admin-only) ----------
//
// A self-service signup arrives as a status='pending' row with a NULL
// password_hash (see requestAccountAction) — it holds no credential at all. The
// admin may correct typos in the same payload, then:
//   - approveRequestAction: apply edits + flip status='active' + ASSIGN THE
//     PASSWORD. Approval is the only moment a requested account gains a
//     credential: either one the approver typed, or the default temporary
//     'Icp@<roll number | email local-part>'. The assigned password is returned
//     once, so the approver can pass it on to the applicant.
//   - rejectRequestAction:  flip status='rejected' (still no credential).
// Both only touch rows that are STILL pending, so a double-click or stale page
// can never re-open a decided request.

export type ApproveRequestInput = {
  id: number;
  role: OnboardRole; // carried from the request row; decides which fields apply
  fullName: string;
  studentId?: string;
  email?: string;
  phone?: string;
  // Student-only
  course?: string;
  className?: string;
  practicalBatch?: string;
  // Staff-only professional details
  employeeId?: string;
  department?: string;
  designation?: string;
  // Optional password the approver typed. Blank/omitted -> the temporary
  // 'Icp@<roll | email local-part>' default is generated instead.
  password?: string;
};

export type RequestResult =
  | { ok: true }
  | { ok: false; error: ActionError };

/** Approval echoes back the password that was assigned, for handoff. */
export type ApproveRequestResult =
  | { ok: true; password: string }
  | { ok: false; error: ActionError; fieldErrors?: FieldErrors };

/** Shortest password an approver may set by hand. */
const MIN_ASSIGNED_PASSWORD = 6;

function revalidateRequestViews() {
  revalidatePath("/admin/requests");
  revalidatePath("/admin/users");
  revalidatePath("/admin");
}

export async function approveRequestAction(
  input: ApproveRequestInput,
): Promise<ApproveRequestResult> {
  // Approvals are Admin + Principal only (stricter than manageUsers).
  if (!(await assertApproveRequests())) return { ok: false, error: "forbidden" };

  const parsed = parseInput(approveRequestSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const data = parsed.data;

  // PASSWORD-OPERATION THROTTLE. Approval mints a credential, so it is rate
  // limited alongside the other password paths.
  const approver = await assertApproveRequests();
  const approvalLimit = await checkRateLimit(
    RULES.passwordOpUser,
    String(approver?.id ?? "unknown"),
  );
  if (!approvalLimit.allowed) {
    return { ok: false, error: "rateLimited" };
  }

  const isStaff = data.role !== "student";
  const fullName = data.fullName;
  const studentId = data.studentId;
  const email = data.email;

  if (!fullName) return { ok: false, error: "missingName" };
  if (isStaff) {
    // Staff sign in by email — required; roll number / academic fields cleared.
    if (!email) return { ok: false, error: "missingEmail" };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "invalidEmail" };
  } else {
    if (!studentId) return { ok: false, error: "missingRollNo" };
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "invalidEmail" };
    }
  }

  // Assign the credential. An approver-supplied password wins; otherwise the
  // deterministic temporary one. Either way the row leaves this action WITH a
  // hash, so an approved account is always actually usable.
  const typed = data.password ?? "";
  if (typed && typed.length < MIN_ASSIGNED_PASSWORD) {
    return { ok: false, error: "weakPassword" };
  }
  const assignedPassword =
    typed || tempPassword(data.role, studentId, email);
  const passwordHash = await bcrypt.hash(assignedPassword, BCRYPT_COST);

  try {
    const res = await db
      .update(users)
      .set({
        fullName,
        studentId: isStaff ? null : studentId,
        email,
        phone: data.phone ?? null,
        course: isStaff ? null : (data.course ?? null),
        className: isStaff ? null : (data.className ?? null),
        practicalBatch: isStaff ? null : (data.practicalBatch ?? null),
        // Professional details are the mirror image — staff keep them, students clear them.
        employeeId: isStaff ? (data.employeeId ?? null) : null,
        department: isStaff ? (data.department ?? null) : null,
        designation: isStaff ? (data.designation ?? null) : null,
        passwordHash,
        status: "active",
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, data.id), eq(users.status, "pending")))
      .returning({ id: users.id });

    if (res.length === 0) return { ok: false, error: "unknown" };
  } catch (err) {
    // A UNIQUE clash on the edited studentId/email surfaces here. The driver
    // message names columns, so it is logged, never returned.
    logServerError("approveRequestAction", err, { id: data.id });
    return { ok: false, error: "duplicate" };
  }

  revalidateRequestViews();
  return { ok: true, password: assignedPassword };
}

// ---------- Edit user details (manageUsers: admin / principal / office admin) ----------
//
// Powers the per-row "Edit" button on the Users grid. Same capability gate as
// creation (`manageUsers`), re-verified here on the server — faculty, staff, and
// students can never reach it. The user's ROLE is authoritative from the DB, not
// the payload, so a forged request can't smuggle academic fields onto a staff
// account or vice-versa. Role itself is intentionally NOT editable here (that's
// an escalation surface handled by the create/anti-escalation path).

export type UpdateUserInput = {
  id: number;
  fullName: string;
  email?: string;
  phone?: string;
  studentId?: string; // roll number — students only
  course?: string;
  className?: string;
  practicalBatch?: string;
  status: "pending" | "active" | "rejected";
};

export type UpdateUserResult =
  // `assignedPassword` is set only when this edit activated an account that had
  // no credential yet (see the backfill below), so the admin can hand it over.
  | { ok: true; assignedPassword?: string }
  | {
      ok: false;
      error: ActionError | "notFound";
      fieldErrors?: FieldErrors;
    };

export async function updateUserAction(
  input: UpdateUserInput,
): Promise<UpdateUserResult> {
  const actor = await assertManageUsers();
  if (!actor) return { ok: false, error: "forbidden" };

  const parsed = parseInput(updateUserSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const data = parsed.data;

  // Load the CURRENT role/status from the DB — never trust the client for which
  // field set applies or for the user's identity.
  const [existing] = await db
    .select({
      id: users.id,
      role: users.role,
      status: users.status,
      passwordHash: users.passwordHash,
    })
    .from(users)
    .where(eq(users.id, data.id))
    .limit(1);
  if (!existing) return { ok: false, error: "notFound" };

  const isStaff = existing.role !== "student";
  const fullName = data.fullName;
  const email = data.email;
  const studentId = data.studentId;

  if (!fullName) return { ok: false, error: "missingName" };
  if (isStaff) {
    // Staff sign in by email — required.
    if (!email) return { ok: false, error: "missingEmail" };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "invalidEmail" };
  } else {
    if (!studentId) return { ok: false, error: "missingRollNo" };
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "invalidEmail" };
    }
  }

  // Normalize the course to its canonical value + academic year (mirrors
  // create/import). Staff carry neither.
  let course: string | null = null;
  let year: number | null = null;
  if (!isStaff) {
    const resolved = resolveStudentCourseYear(data.course, data.className);
    if (!resolved.ok) return { ok: false, error: "invalidCourse" };
    course = resolved.course ?? null;
    year = resolved.year ?? null;
  }

  // Whitelist the status; never let an actor change their OWN status (a demotion
  // to pending/rejected would lock them out of the console they're using).
  const allowed = ["pending", "active", "rejected"] as const;
  const requested = allowed.includes(data.status) ? data.status : existing.status;
  const nextStatus = actor.id === data.id ? existing.status : requested;

  // Credential backfill. A pending self-service signup carries a NULL
  // password_hash, so activating it from this screen (rather than through the
  // approval queue) would otherwise leave an "active" account that can never
  // sign in. Mint the same temporary password the approval path uses, and
  // report it back so the admin can pass it on. Accounts that already have a
  // hash are never touched here.
  const needsCredential =
    nextStatus === "active" && !existing.passwordHash;
  const assignedPassword = needsCredential
    ? tempPassword(existing.role as Role, studentId, email)
    : undefined;
  const passwordHash = assignedPassword
    ? await bcrypt.hash(assignedPassword, BCRYPT_COST)
    : undefined;

  try {
    const res = await db
      .update(users)
      .set({
        fullName,
        email: email ?? null,
        phone: data.phone ?? null,
        studentId: isStaff ? null : studentId,
        course: isStaff ? null : course,
        year: isStaff ? null : year,
        className: isStaff ? null : (data.className ?? null),
        practicalBatch: isStaff ? null : (data.practicalBatch ?? null),
        ...(passwordHash ? { passwordHash } : {}),
        status: nextStatus,
        updatedAt: new Date(),
      })
      .where(eq(users.id, data.id))
      .returning({ id: users.id });

    if (res.length === 0) return { ok: false, error: "notFound" };
  } catch (err) {
    // A UNIQUE clash on the edited studentId/email surfaces here.
    logServerError("updateUserAction", err, { id: data.id });
    return { ok: false, error: "duplicate" };
  }

  revalidatePath("/admin/users");
  revalidatePath("/admin");
  revalidatePath("/admin/requests");
  return { ok: true, assignedPassword };
}

// ---------- Account deletion (admin-only) ----------
//
// Hard-deletes a user row. FK enforcement is off on the libSQL connection, so
// this never errors on dependent rows; any historical attendance/fee/ticket
// rows simply become orphaned and are already skipped by the admin views that
// join back to `users`. An admin cannot delete their own account.

export type DeleteUserResult =
  | { ok: true; message: string }
  | {
      ok: false;
      error:
        | "forbidden"
        | "self"
        | "notFound"
        | "deleteFailed"
        | "rateLimited";
      retryAfter?: number;
    };

export async function deleteUserAction(
  rawUserId: number,
): Promise<DeleteUserResult> {
  // Deletion is the single most destructive action — admin only (deleteUsers).
  const admin = await currentUserWithCapability("deleteUsers");
  if (!admin) return { ok: false, error: "forbidden" };

  const parsedId = parseInput(idSchema, rawUserId);
  if (!parsedId.ok) return { ok: false, error: "notFound" };
  const userId = parsedId.data;

  // BULK-DELETE THROTTLE. Deletion cascades across tickets, ledgers and
  // attendance, so a script driving this action in a loop is the most
  // destructive thing a compromised admin session can do. Capped per admin,
  // well above any plausible manual rate.
  const limit = await checkRateLimit(RULES.deleteUser, String(admin.id));
  if (!limit.allowed) {
    return { ok: false, error: "rateLimited", retryAfter: limit.retryAfter };
  }

  if (admin.id === userId) return { ok: false, error: "self" };

  // Cascading delete: remove dependent rows (children) before the user (parent)
  // so SQLite's FOREIGN KEY constraint is never violated.
  let res: { id: number }[];
  try {
    // 1. Support tickets raised by the user.
    await db
      .delete(supportTickets)
      .where(eq(supportTickets.studentId, userId));

    // 2. Fee ledgers the user is a student on or recorded.
    await db
      .delete(feeLedgers)
      .where(
        or(
          eq(feeLedgers.studentId, userId),
          eq(feeLedgers.recordedBy, userId),
        ),
      );

    // 3. Attendance logs for the user or that the user marked.
    await db
      .delete(attendanceLogs)
      .where(
        or(
          eq(attendanceLogs.studentId, userId),
          eq(attendanceLogs.markedBy, userId),
        ),
      );

    // 4. text_overrides has no user FK — nothing to delete.

    // 5. Finally the user row itself.
    res = await db
      .delete(users)
      .where(eq(users.id, userId))
      .returning({ id: users.id });
  } catch (err) {
    logServerError("deleteUserAction", err, { userId });
    return { ok: false, error: "deleteFailed" };
  }

  if (res.length === 0) return { ok: false, error: "notFound" };

  revalidatePath("/admin/users");
  revalidatePath("/admin/requests");
  revalidatePath("/admin");
  return {
    ok: true,
    message: "User and all related records deleted successfully.",
  };
}

export async function rejectRequestAction(
  rawId: number,
): Promise<RequestResult> {
  // Rejections are Admin + Principal only (stricter than manageUsers).
  if (!(await assertApproveRequests())) return { ok: false, error: "forbidden" };

  const parsedId = parseInput(idSchema, rawId);
  if (!parsedId.ok) return { ok: false, error: "validation" };
  const id = parsedId.data;

  const res = await db
    .update(users)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(users.id, id), eq(users.status, "pending")))
    .returning({ id: users.id });

  if (res.length === 0) return { ok: false, error: "unknown" };

  revalidateRequestViews();
  return { ok: true };
}
