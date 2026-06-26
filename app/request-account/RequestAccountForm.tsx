"use client";

// Public account-request form. Styled like the login screen (centered card on
// the app canvas, prominent language switcher) since it lives outside the
// dashboard shell. Course/Class/Batch are plain <select>s (no Edit Mode context
// out here). On success we swap the form for a confirmation panel — the student
// can't sign in until an admin approves, so there's nowhere to redirect them.

import { useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Eye, EyeOff } from "lucide-react";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { useT } from "@/components/i18n/LanguageProvider";
import {
  requestAccountAction,
  type RequestAccountError,
} from "@/app/actions/auth";

type Item = { value: string; label: string };
// Server error codes + a client-only "passwords don't match" check. All map to
// requestAccount.errors.<code> translation keys.
type FormError = RequestAccountError | "passwordMismatch";

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
  const [done, setDone] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const [fullName, setFullName] = useState("");
  const [studentId, setStudentId] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [course, setCourse] = useState("");
  const [className, setClassName] = useState("");
  const [practicalBatch, setPracticalBatch] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 6) {
      setError("weakPassword");
      return;
    }
    if (password !== confirm) {
      setError("passwordMismatch");
      return;
    }

    startTransition(async () => {
      const result = await requestAccountAction({
        fullName,
        studentId,
        email,
        phone,
        course,
        className,
        practicalBatch,
        password,
      });
      if (result.ok) setDone(true);
      else setError(result.error);
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
          <LanguageSwitcher />
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label={t("requestAccount.email")}
                    htmlFor="ra-email"
                    optional={t("requestAccount.optional")}
                  >
                    <input
                      id="ra-email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder={t("requestAccount.emailPlaceholder")}
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

                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label={t("requestAccount.password")}
                    htmlFor="ra-password"
                  >
                    <div className="relative">
                      <input
                        id="ra-password"
                        type={showPassword ? "text" : "password"}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder={t("requestAccount.passwordPlaceholder")}
                        required
                        autoComplete="new-password"
                        className={`${inputClass} pr-10`}
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword((s) => !s)}
                        aria-label={
                          showPassword
                            ? t("login.hidePassword")
                            : t("login.showPassword")
                        }
                        className="absolute inset-y-0 right-0 flex items-center px-3 text-muted hover:text-ink"
                      >
                        {showPassword ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                  </Field>
                  <Field
                    label={t("requestAccount.confirmPassword")}
                    htmlFor="ra-confirm"
                  >
                    <input
                      id="ra-confirm"
                      type={showPassword ? "text" : "password"}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder={t("requestAccount.confirmPasswordPlaceholder")}
                      required
                      autoComplete="new-password"
                      className={inputClass}
                    />
                  </Field>
                </div>

                {error && (
                  <p
                    role="alert"
                    aria-live="polite"
                    className="rounded-md border border-danger/40 bg-lavender px-3 py-2 text-sm text-danger"
                  >
                    {t(`requestAccount.errors.${error}`)}
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
