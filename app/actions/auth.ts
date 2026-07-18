"use server";

// Auth server actions. Login validates credentials with bcrypt and issues the
// session cookie; logout clears it. Error results are returned as CODES so the
// client can translate them via useT() (login.errors.<code>).

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clearSession, setSession } from "@/lib/auth";
import type { Role } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";

export type LoginState = {
  error: "required" | "invalid" | "pending" | "rejected" | null;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const mode = String(formData.get("mode") ?? "student");
  const identifier = String(formData.get("identifier") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const localeRaw = String(formData.get("locale") ?? "");
  const locale: Locale = isLocale(localeRaw) ? localeRaw : "en";

  if (!identifier || !password) return { error: "required" };

  // Look up by student ID (students) or email (staff).
  const [user] =
    mode === "staff"
      ? await db
          .select()
          .from(users)
          .where(eq(users.email, identifier.toLowerCase()))
          .limit(1)
      : await db
          .select()
          .from(users)
          .where(eq(users.studentId, identifier))
          .limit(1);

  if (!user || !user.passwordHash) return { error: "invalid" };

  // Pending/rejected accounts cannot log in — show a clear reason.
  if (user.status === "pending") return { error: "pending" };
  if (user.status === "rejected") return { error: "rejected" };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { error: "invalid" };

  // Persist the chosen UI language to the profile (best-effort).
  if (user.preferredLanguage !== locale) {
    await db
      .update(users)
      .set({ preferredLanguage: locale, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  }

  await setSession({
    userId: user.id,
    role: user.role as Role,
    name: user.fullName,
    preferredLanguage: locale,
  });

  // redirect() throws — control never returns to the client on success.
  redirect("/dashboard");
}

export async function logoutAction(): Promise<void> {
  await clearSession();
  redirect("/login");
}

// ---------- Public self-service account requests ----------
//
// DYNAMIC by role. A request lands as status='pending' with a hashed password
// the applicant chose, so login can show the friendly "awaiting approval"
// message (login requires a passwordHash before it reads status). Admin /
// Principal then review it in /admin/requests, fix any typos, and flip it to
// 'active'. The field set depends on the requested role:
//   - student            -> roll number + course / class / practical batch
//   - principal/office admin/faculty/staff -> email + employee ID / department /
//                            designation (email is their login identifier)
// Admin can NEVER be self-requested — that role is created internally only.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

// Roles the public form may request: every role EXCEPT admin. This is the
// server-side allow-list — never trust the client's role string.
const SELF_SERVICE_ROLES: readonly Role[] = [
  "student",
  "principal",
  "office admin",
  "faculty",
  "staff",
];

export type RequestAccountInput = {
  role: Role;
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
  password: string;
};

export type RequestAccountError =
  | "invalidRole"
  | "missingName"
  | "missingRollNo"
  | "missingEmail"
  | "missingPhone"
  | "invalidEmail"
  | "weakPassword"
  | "duplicate"
  | "unknown";

export type RequestAccountResult =
  | { ok: true }
  | { ok: false; error: RequestAccountError };

export async function requestAccountAction(
  input: RequestAccountInput,
): Promise<RequestAccountResult> {
  // Guard the role first — an unknown value or a self-requested "admin" is
  // rejected outright before anything is written.
  if (!SELF_SERVICE_ROLES.includes(input.role)) {
    return { ok: false, error: "invalidRole" };
  }
  const role = input.role;
  const isStudent = role === "student";

  const fullName = input.fullName?.trim() ?? "";
  const studentId = input.studentId?.trim() || undefined;
  const email = input.email?.trim().toLowerCase() || undefined;
  const phone = input.phone?.trim() || undefined;
  const password = input.password ?? "";

  if (!fullName) return { ok: false, error: "missingName" };

  if (isStudent) {
    // Students sign in by roll number; email is optional.
    if (!studentId) return { ok: false, error: "missingRollNo" };
    if (email && !EMAIL_RE.test(email)) {
      return { ok: false, error: "invalidEmail" };
    }
  } else {
    // Staff roles sign in by email — required and validated.
    if (!email) return { ok: false, error: "missingEmail" };
    if (!EMAIL_RE.test(email)) return { ok: false, error: "invalidEmail" };
  }

  if (password.length < MIN_PASSWORD) {
    return { ok: false, error: "weakPassword" };
  }

  try {
    const passwordHash = await bcrypt.hash(password, 10);
    const res = await db
      .insert(users)
      .values({
        fullName,
        // Only the role-appropriate identity fields are persisted.
        studentId: isStudent ? studentId : undefined,
        email,
        phone,
        role,
        status: "pending",
        // Student-only academic fields.
        course: isStudent ? input.course?.trim() || undefined : undefined,
        className: isStudent ? input.className?.trim() || undefined : undefined,
        practicalBatch: isStudent
          ? input.practicalBatch?.trim() || undefined
          : undefined,
        // Staff-only professional fields.
        employeeId: isStudent ? undefined : input.employeeId?.trim() || undefined,
        department: isStudent ? undefined : input.department?.trim() || undefined,
        designation: isStudent
          ? undefined
          : input.designation?.trim() || undefined,
        passwordHash,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });

    // No row back => a UNIQUE (studentId or email) row already exists.
    if (res.length === 0) return { ok: false, error: "duplicate" };
    return { ok: true };
  } catch {
    return { ok: false, error: "unknown" };
  }
}
