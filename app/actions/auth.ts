"use server";

// Auth server actions. Login validates credentials with bcrypt and issues the
// session cookie; logout clears it. Error results are returned as CODES so the
// client can translate them via useT() (login.errors.<code>).

import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { users } from "@/db/schema";
import { clearSession, setSession } from "@/lib/auth";
import type { Role } from "@/lib/auth/session";
import { isLocale, type Locale } from "@/lib/i18n/config";
import { logServerError } from "@/lib/errors";
import { RULES, checkRateLimit } from "@/lib/rate-limit";
import { parseInput, type FieldErrors } from "@/lib/validation/core";
import { loginSchema, requestAccountSchema } from "@/lib/validation/schemas";
import { SPLASH_COOKIE } from "@/components/splash/constants";

export type LoginState = {
  error:
    | "required"
    | "invalid"
    | "pending"
    | "rejected"
    | "rateLimited"
    | null;
  /** Seconds to wait, set only when error === "rateLimited". */
  retryAfter?: number;
};

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  // Normalize FormData (always strings) before validating. `locale` falls back
  // to the default rather than failing — the user did not type it, so a stale
  // hidden field must never block a sign-in.
  const localeRaw = String(formData.get("locale") ?? "");
  const locale: Locale = isLocale(localeRaw) ? localeRaw : "en";

  // SERVER-SIDE validation at the entry point, before any DB call. The login
  // form's own `required` attributes are UX only and are not trusted here.
  const parsed = parseInput(loginSchema, {
    mode: String(formData.get("mode") ?? "student"),
    identifier: String(formData.get("identifier") ?? "").trim(),
    password: String(formData.get("password") ?? ""),
    locale,
  });
  if (!parsed.ok) {
    // Login deliberately returns ONE generic code rather than field-level
    // detail: telling an anonymous caller which half of a credential pair was
    // malformed is a probing oracle. Shape problems are the user's own doing
    // and "fill in all fields" covers every case the form can produce.
    return { error: "required" };
  }
  const { mode, identifier, password } = parsed.data;

  // PER-IDENTIFIER THROTTLE. The proxy already caps attempts per IP; this caps
  // attempts against one ACCOUNT, so the two cannot be played off against each
  // other: rotating IPs still exhausts this counter, and rotating identifiers
  // still exhausts the IP counter in proxy.ts.
  //
  // It runs BEFORE the user lookup, so a locked-out attacker cannot use timing
  // or the response to learn whether the account exists. It also counts on the
  // identifier as TYPED, so probing "Admin@icp.local" and "admin@icp.local"
  // shares one bucket (normalizeSubject lowercases the key).
  //
  // A Server Action returns a value, not a Response, so it cannot emit a real
  // 429 + Retry-After. It returns retryAfter in the result and the login form
  // renders the wait; the HTTP 429 for this surface comes from proxy.ts.
  const identifierLimit = await checkRateLimit(
    RULES.loginIdentifier,
    `${mode}:${identifier}`,
  );
  if (!identifierLimit.allowed) {
    return { error: "rateLimited", retryAfter: identifierLimit.retryAfter };
  }

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

  // NON-LEAKING ORDER. Account status is only ever disclosed AFTER the supplied
  // password has been verified, so an anonymous prober can never use the login
  // form to learn whether a given roll number / email exists, or what state it
  // is in. Every pre-verification failure — unknown identifier, no password set
  // (a pending self-service signup, which has a NULL password_hash until an
  // admin approves it), or a wrong password — returns the single generic
  // "invalid" code. Its copy also covers the not-yet-active case, so an
  // applicant still reads a clear explanation without anything being leaked.
  if (!user || !user.passwordHash) return { error: "invalid" };

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) return { error: "invalid" };

  // Password proven. Only now is it safe to name the account's actual state —
  // e.g. an active user an admin has since set back to pending or rejected.
  if (user.status === "pending") return { error: "pending" };
  if (user.status === "rejected") return { error: "rejected" };

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

  // ---- Post-login splash: arm the one-shot flag. --------------------------
  //
  // THIS is the point in the auth flow where the splash is triggered: after the
  // credential is proven and the session issued, before the redirect. Setting
  // it anywhere earlier would show the splash to someone who failed to log in.
  //
  // Deliberately NOT httpOnly: the client half deletes this cookie the moment
  // it mounts, which is what makes it one-shot. It holds no secret — just "1" —
  // so JS visibility costs nothing. Max-Age is 30s so that even if scripting is
  // blocked and it is never consumed, it cannot linger and re-fire later.
  const store = await cookies();
  store.set(SPLASH_COOKIE, "1", {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 30,
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
// DYNAMIC by role. A request lands as status='pending' with a NULL
// password_hash — the applicant never chooses their own credential, so a public
// signup can never produce anything that is able to authenticate. Admin /
// Principal then review it in /admin/requests, fix any typos, and approve it,
// which is the step that both flips status='active' AND assigns the password
// (see approveRequestAction). The field set depends on the requested role:
//   - student            -> roll number + course / class / practical batch
//   - principal/office admin/faculty/staff -> email + employee ID / department /
//                            designation (email is their login identifier)
// Admin can NEVER be self-requested — that role is created internally only.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  // NOTE: deliberately no `password`. A request carries no credential at all —
  // the admin assigns one at approval time.
};

export type RequestAccountError =
  | "invalidRole"
  | "missingName"
  | "missingRollNo"
  | "missingEmail"
  | "missingPhone"
  | "invalidEmail"
  | "validation"
  | "rateLimited"
  | "duplicate"
  | "unknown";

export type RequestAccountResult =
  | { ok: true }
  | {
      ok: false;
      error: RequestAccountError;
      fieldErrors?: FieldErrors;
      /** Seconds to wait, set only when error === "rateLimited". */
      retryAfter?: number;
    };

export async function requestAccountAction(
  input: RequestAccountInput,
): Promise<RequestAccountResult> {
  // STRUCTURAL validation first: types, lengths, formats, and — via
  // z.strictObject — rejection of any key that is not part of this payload, so
  // a crafted body can never smuggle `role: "admin"`-adjacent extras such as
  // `status` or `passwordHash` toward the insert below.
  const parsed = parseInput(requestAccountSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const data = parsed.data;

  // Business rules below are UNCHANGED — validation is a layer in front of them,
  // not a replacement.

  // Guard the role first — an unknown value or a self-requested "admin" is
  // rejected outright before anything is written.
  if (!SELF_SERVICE_ROLES.includes(data.role)) {
    return { ok: false, error: "invalidRole" };
  }
  const role = data.role;
  const isStudent = role === "student";

  // Already trimmed / lowercased / emptied-to-undefined by the schema.
  const fullName = data.fullName;
  const studentId = data.studentId;
  const email = data.email;
  const phone = data.phone;

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

  // PER-IDENTITY THROTTLE, complementing the per-IP limit in proxy.ts. Keyed on
  // the roll number / email being claimed, so one attacker cannot flood the
  // pending queue with variations of the same person from rotating addresses.
  // Checked only after the identity fields are known to be well formed, so a
  // malformed submission does not burn the applicant's own allowance.
  const identityLimit = await checkRateLimit(
    RULES.requestAccountIdentity,
    email ?? studentId ?? "unknown",
  );
  if (!identityLimit.allowed) {
    return {
      ok: false,
      error: "rateLimited",
      retryAfter: identityLimit.retryAfter,
    };
  }

  try {
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
        course: isStudent ? data.course : undefined,
        className: isStudent ? data.className : undefined,
        practicalBatch: isStudent ? data.practicalBatch : undefined,
        // Staff-only professional fields.
        employeeId: isStudent ? undefined : data.employeeId,
        department: isStudent ? undefined : data.department,
        designation: isStudent ? undefined : data.designation,
        // No credential is written: password_hash stays NULL until approval, so
        // this row can never authenticate no matter what status it is given.
        passwordHash: null,
      })
      .onConflictDoNothing()
      .returning({ id: users.id });

    // No row back => a UNIQUE (studentId or email) row already exists.
    if (res.length === 0) return { ok: false, error: "duplicate" };
    return { ok: true };
  } catch (err) {
    // Detail to the server log; a generic code to the (unauthenticated) client.
    logServerError("requestAccountAction", err, { role });
    return { ok: false, error: "unknown" };
  }
}
