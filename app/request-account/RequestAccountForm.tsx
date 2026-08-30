"use client";

// Public account-request form. Styled like the login screen (centered card on
// the app canvas, prominent language switcher) since it lives outside the
// dashboard shell. Course/Class/Batch are plain <select>s (no Edit Mode context
// out here). On success we swap the form for a confirmation panel — the student
// can't sign in until an admin approves, so there's nowhere to redirect them.
//
// NO PASSWORD IS COLLECTED HERE. A request is stored with a NULL password_hash;
// the approving admin assigns the credential and passes it to the applicant, so
// a public form can never create anything that is able to authenticate.

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import {
  requestAccountAction,
  type RequestAccountError,
} from "@/app/actions/auth";
import type { Role } from "@/lib/auth/permissions";
import {
  fieldErrorSuffix,
  type FieldErrors,
} from "@/lib/validation/client";

type Item = { value: string; label: string };
// Server error codes map straight to requestAccount.errors.<code> keys.
type FormError = RequestAccountError;

// Roles the public may apply for — every role EXCEPT admin. Order matters (shown
// as-is in the dropdown). The server re-checks this list; the client just mirrors it.
const APPLICABLE_ROLES: { value: Role; labelKey: string }[] = [
  { value: "student", labelKey: "onboarding.roleStudent" },
  { value: "principal", labelKey: "onboarding.rolePrincipal" },
  { value: "office admin", labelKey: "onboarding.roleOfficeAdmin" },
  { value: "faculty", labelKey: "onboarding.roleFaculty" },
  { value: "staff", labelKey: "onboarding.roleStaff" },
];

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-teal";

export function RequestAccountForm({
  courseOptions,
  classOptions,
  batchOptions,
}: {
  courseOptions: Item[];
  classOptions: Item[];
  batchOptions: Item[];
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<FormError | null>(null);
  // Field-level detail from the server schema, appended to the error line.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors | undefined>();
  // Seconds to wait, set only when the server reports a rate-limit hit.
  const [retryAfter, setRetryAfter] = useState<number | undefined>();
  const [done, setDone] = useState(false);

  const [role, setRole] = useState<Role>("student");
  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [course, setCourse] = useState("");
  const [className, setClassName] = useState("");
  const [practicalBatch, setPracticalBatch] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [department, setDepartment] = useState("");
  const [designation, setDesignation] = useState("");

  const isStudent = role === "student";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    startTransition(async () => {
      const result = await requestAccountAction({
        role,
        fullName,
        studentId,
        email,
        phone,
        course,
        className,
        practicalBatch,
        employeeId,
        department,
        designation,
      });
      if (result.ok) setDone(true);
      else {
        setError(result.error);
        setFieldErrors(result.fieldErrors);
        setRetryAfter(result.retryAfter);
      }
    });
  };

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="mb-6 flex flex-col items-center gap-4 text-center">
          <div>
            <h1 className="text-2xl font-semibold text-ink">
              {t("common.appName")}
            </h1>
            <p className="mt-1 text-sm text-muted">{t("common.collegeName")}</p>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-surface p-6 shadow-sm sm:p-8">
          {done ? (
            <div className="flex flex-col items-center gap-3 py-6 text-center">
              <CheckCircle2 className="size-10 text-teal" aria-hidden />
              <h2 className="text-lg font-semibold text-ink">
                {t("requestAccount.successTitle")}
              </h2>
              <p className="text-sm text-muted">
                {t("requestAccount.successBody")}
              </p>
              <Link
                href="/login"
                className="mt-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover"
              >
                {t("requestAccount.backToLogin")}
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink">
                {t("requestAccount.title")}
              </h2>
              <p className="mt-1 text-sm text-muted">
                {t("requestAccount.subtitle")}
              </p>

              <form onSubmit={submit} className="mt-5 space-y-4">
                {/* Role selector — drives which field set renders below. */}
                <Field label={t("requestAccount.roleQuestion")} htmlFor="ra-role">
                  <select
                    id="ra-role"
                    value={role}
                    onChange={(e) => setRole(e.target.value as Role)}
                    required
                    className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
                  >
                    {APPLICABLE_ROLES.map((r) => (
                      <option key={r.value} value={r.value}>
                        {t(r.labelKey)}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field label={t("requestAccount.fullName")} htmlFor="ra-name">
                  <input
                    id="ra-name"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder={t("requestAccount.fullNamePlaceholder")}
                    required
                    autoComplete="name"
                    className={inputClass}
                  />
                </Field>

                {/* Student sign in by roll number (required). */}
                {isStudent && (
                  <Field label={t("requestAccount.rollNo")} htmlFor="ra-roll">
                    <input
                      id="ra-roll"
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                      placeholder={t("requestAccount.rollNoPlaceholder")}
                      required
                      className={inputClass}
                    />
                  </Field>
                )}

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label={t("requestAccount.email")}
                    htmlFor="ra-email"
                    // Staff authenticate by email → required; optional for students.
                    optional={
                      isStudent ? t("requestAccount.optional") : undefined
                    }
                  >
                    <input
                      id="ra-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("requestAccount.emailPlaceholder")}
                      required={!isStudent}
                      autoComplete="email"
                      className={inputClass}
                    />
                  </Field>
                  <Field
                    label={t("requestAccount.phone")}
                    htmlFor="ra-phone"
                    optional={t("requestAccount.optional")}
                  >
                    <input
                      id="ra-phone"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t("requestAccount.phonePlaceholder")}
                      autoComplete="tel"
                      className={inputClass}
                    />
                  </Field>
                </div>

                {/* Student-only academic fields. */}
                {isStudent && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field label={t("requestAccount.course")} htmlFor="ra-course">
                      <Select
                        id="ra-course"
                        value={course}
                        onChange={setCourse}
                        options={courseOptions}
                        placeholder={t("requestAccount.selectPlaceholder")}
                      />
                    </Field>
                    <Field label={t("requestAccount.class")} htmlFor="ra-class">
                      <Select
                        id="ra-class"
                        value={className}
                        onChange={setClassName}
                        options={classOptions}
                        placeholder={t("requestAccount.selectPlaceholder")}
                      />
                    </Field>
                    <Field
                      label={t("requestAccount.practicalBatch")}
                      htmlFor="ra-batch"
                    >
                      <Select
                        id="ra-batch"
                        value={practicalBatch}
                        onChange={setPracticalBatch}
                        options={batchOptions}
                        placeholder={t("requestAccount.selectPlaceholder")}
                      />
                    </Field>
                  </div>
                )}

                {/* Staff-only professional fields. */}
                {!isStudent && (
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                    <Field
                      label={t("requestAccount.employeeId")}
                      htmlFor="ra-empid"
                    >
                      <input
                        id="ra-empid"
                        value={employeeId}
                        onChange={(e) => setEmployeeId(e.target.value)}
                        placeholder={t("requestAccount.employeeIdPlaceholder")}
                        className={inputClass}
                      />
                    </Field>
                    <Field
                      label={t("requestAccount.department")}
                      htmlFor="ra-dept"
                    >
                      <input
                        id="ra-dept"
                        value={department}
                        onChange={(e) => setDepartment(e.target.value)}
                        placeholder={t("requestAccount.departmentPlaceholder")}
                        className={inputClass}
                      />
                    </Field>
                    <Field
                      label={t("requestAccount.designation")}
                      htmlFor="ra-desig"
                    >
                      <input
                        id="ra-desig"
                        value={designation}
                        onChange={(e) => setDesignation(e.target.value)}
                        placeholder={t("requestAccount.designationPlaceholder")}
                        className={inputClass}
                      />
                    </Field>
                  </div>
                )}

                {/* No password fields: the approving admin assigns the
                    credential. See the file header. */}
                <p className="rounded-md border border-line bg-canvas px-3 py-2 text-xs text-muted">
                  {t("requestAccount.credentialNote")}
                </p>

                {error && (
                  <p
                    role="alert"
                    aria-live="polite"
                    className="rounded-md border border-danger/40 bg-lavender px-3 py-2 text-sm text-danger"
                  >
                    {error === "rateLimited"
                      ? t("requestAccount.errors.rateLimited", {
                          minutes: Math.max(
                            1,
                            Math.ceil((retryAfter ?? 3600) / 60),
                          ),
                        })
                      : t(`requestAccount.errors.${error}`)}
                    {fieldErrorSuffix(fieldErrors)}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={pending}
                  className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {pending
                    ? t("requestAccount.submitting")
                    : t("requestAccount.submit")}
                </button>
              </form>

              <p className="mt-5 text-center text-sm text-muted">
                {t("requestAccount.haveAccount")}{" "}
                <Link
                  href="/login"
                  className="font-medium text-primary hover:text-primary-hover"
                >
                  {t("requestAccount.backToLogin")}
                </Link>
              </p>
            </>
          )}
        </div>
      </div>
    </main>
  );
}

function Select({
  id,
  value,
  onChange,
  options,
  placeholder,
}: {
  id: string;
  value: string;
  onChange: (v: string) => void;
  options: Item[];
  placeholder: string;
}) {
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
    >
      <option value="">{placeholder}</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function Field({
  label,
  htmlFor,
  optional,
  children,
}: {
  label: string;
  htmlFor?: string;
  optional?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 flex items-center gap-1 text-sm font-medium text-ink"
      >
        {label}
        {optional && (
          <span className="text-xs font-normal text-muted">({optional})</span>
        )}
      </label>
      {children}
    </div>
  );
}
