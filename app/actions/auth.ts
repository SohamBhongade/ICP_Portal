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
// A student requests access; the row lands as status='pending' with a hashed
// password they chose, so login can show the friendly "awaiting approval"
// message (login requires a passwordHash before it reads status). An admin then
// reviews it in /admin/requests, fixes any typos, and flips it to 'active'.
// This is the ONLY unauthenticated write — staff are always admin-created.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 6;

export type RequestAccountInput = {
  fullName: string;
  studentId: string;
  email?: string;
  phone?: string;
  course?: string;
  className?: string;
  practicalBatch?: string;
  password: string;
};

export type RequestAccountError =
  | "missingName"
  | "missingRollNo"
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
  const fullName = input.fullName?.trim() ?? "";
  const studentId = input.studentId?.trim() ?? "";
  const email = input.email?.trim().toLowerCase() || undefined;
  const phone = input.phone?.trim() || undefined;
  const password = input.password ?? "";

  if (!fullName) return { ok: false, error: "missingName" };
  if (!studentId) return { ok: false, error: "missingRollNo" };
  if (email && !EMAIL_RE.test(email)) {
    return { ok: false, error: "invalidEmail" };
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
        studentId,
        email,
        phone,
        role: "student",
        status: "pending",
        course: input.course?.trim() || undefined,
        className: input.className?.trim() || undefined,
        practicalBatch: input.practicalBatch?.trim() || undefined,
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
