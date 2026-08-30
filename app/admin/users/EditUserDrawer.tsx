"use client";

// Edit an existing user — a right-hand slide-over, mirroring CreateUserDrawer.
//
// Prepopulated from the selected row. The account type (role) is shown read-only
// here — changing roles is an escalation surface owned by the create path, not
// this edit form. Academic fields (Course / Class / Practical batch) only apply
// to students, matching how the row was created. Status is editable EXCEPT on
// your own account (a self-demotion would lock you out); the server enforces the
// same rule regardless of what the client sends.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  EditableDropdown,
  type DropdownOptionItem,
} from "@/components/edit-mode/EditableDropdown";
import { updateUserAction, type ActionError } from "@/app/actions/onboarding";
import type { Role } from "@/lib/auth/permissions";
import {
  fieldErrorSuffix,
  type FieldErrors,
} from "@/lib/validation/client";
import type { ToastKind, UserRow } from "./UsersContent";

// Translation keys per role (mirrors ROLE_LABEL in UsersContent).
const ROLE_LABEL_KEY: Record<Role, string> = {
  admin: "onboarding.roleAdmin",
  principal: "onboarding.rolePrincipal",
  "office admin": "onboarding.roleOfficeAdmin",
  faculty: "onboarding.roleFaculty",
  staff: "onboarding.roleStaff",
  student: "onboarding.roleStudent",
};

const STATUSES: UserRow["status"][] = ["active", "pending", "rejected"];
const STATUS_LABEL_KEY: Record<UserRow["status"], string> = {
  active: "onboarding.statusActive",
  pending: "onboarding.statusPending",
  rejected: "onboarding.statusRejected",
};

// Loosely-normalize a value for tolerant comparison: lowercase + strip anything
// that isn't a letter or digit. Lets "B.pharm" match option "B.Pharm", and
// "Second" match "Second Year".
const loose = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Resolve a stored DB value to the dropdown OPTION value it should select.
 * Stored values can drift from an option's exact string — different casing or
 * punctuation ("B.pharm" vs "B.Pharm") or a shorthand ("Second" for "Second
 * Year"). We match tolerantly and return the option's canonical value so the
 * select prepopulates. Falls back to the raw value (EditableDropdown still shows
 * it via its safety-net option), so nothing is ever silently dropped.
 */
function matchOptionValue(raw: string, options: DropdownOptionItem[]): string {
  if (!raw) return "";
  // 1) exact match — the common, already-aligned case.
  if (options.some((o) => o.value === raw)) return raw;
  const target = loose(raw);
  if (!target) return raw;
  // 2) case / punctuation-insensitive exact match.
  const ci = options.find((o) => loose(o.value) === target);
  if (ci) return ci.value;
  // 3) prefix either direction — handles shorthand like "Second" ↔ "Second Year".
  const prefix = options.find(
    (o) => loose(o.value).startsWith(target) || target.startsWith(loose(o.value)),
  );
  return prefix ? prefix.value : raw;
}

export function EditUserDrawer({
  user,
  isSelf,
  courseOptions,
  classOptions,
  batchOptions,
  onClose,
  notify,
}: {
  user: UserRow;
  // True when editing your own account — status is then locked (self-lockout guard).
  isSelf: boolean;
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  batchOptions: DropdownOptionItem[];
  onClose: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | "notFound" | null>(null);
  // Field-level detail from the server schema, appended to the error line.
  const [fieldErrors, setFieldErrors] = useState<FieldErrors | undefined>();

  const isStudent = user.role === "student";

  const [fullName, setFullName] = useState(user.fullName);
  const [email, setEmail] = useState(user.email ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [studentId, setStudentId] = useState(user.studentId ?? "");
  // Resolve stored values to the matching option so the selects prepopulate even
  // when the DB value drifts from the option's exact string (case / shorthand).
  const [course, setCourse] = useState(() =>
    matchOptionValue(user.course ?? "", courseOptions),
  );
  const [className, setClassName] = useState(() =>
    matchOptionValue(user.className ?? "", classOptions),
  );
  const [practicalBatch, setPracticalBatch] = useState(() =>
    matchOptionValue(user.practicalBatch ?? "", batchOptions),
  );
  const [status, setStatus] = useState<UserRow["status"]>(user.status);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await updateUserAction({
        id: user.id,
        fullName,
        email,
        phone,
        studentId,
        course,
        className,
        practicalBatch,
        status,
      });
      if (result.ok) {
        // Activating an account that had no credential yet mints a temporary
        // password — show it once so the admin can pass it to the user.
        notify(
          "success",
          result.assignedPassword
            ? t("onboarding.toast.updatedWithPassword", {
                name: fullName.trim(),
                password: result.assignedPassword,
              })
            : t("onboarding.toast.updated", { name: fullName.trim() }),
        );
        router.refresh();
        onClose();
      } else {
        setError(result.error);
        setFieldErrors(result.fieldErrors);
        notify("error", t("onboarding.toast.updateFailed"));
      }
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button
        type="button"
        aria-label={t("onboarding.create.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            <Editable tKey="onboarding.editUser.title" />
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("onboarding.create.cancel")}
            className="rounded p-1 text-muted hover:bg-lavender hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-1 flex-col gap-4 p-5">
          {/* Role is read-only here (not an editable escalation surface). */}
          <Field label={t("onboarding.editUser.roleLabel")}>
            <div className="rounded-md border border-line bg-canvas px-3 py-2 text-sm text-muted">
              {t(ROLE_LABEL_KEY[user.role])}
            </div>
          </Field>

          <Field label={t("onboarding.create.fullName")} htmlFor="eu-name">
            <input
              id="eu-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("onboarding.create.fullNamePlaceholder")}
              required
              className={inputClass}
            />
          </Field>

          {isStudent && (
            <Field label={t("onboarding.create.rollNo")} htmlFor="eu-roll">
              <input
                id="eu-roll"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                placeholder={t("onboarding.create.rollNoPlaceholder")}
                required
                className={inputClass}
              />
            </Field>
          )}

          <Field
            label={t("onboarding.create.email")}
            htmlFor="eu-email"
            optional={isStudent ? t("onboarding.create.optional") : undefined}
          >
            <input
              id="eu-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={t("onboarding.create.emailPlaceholder")}
              required={!isStudent}
              className={inputClass}
            />
          </Field>

          <Field
            label={t("onboarding.create.phone")}
            htmlFor="eu-phone"
            optional={t("onboarding.create.optional")}
          >
            <input
              id="eu-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder={t("onboarding.create.phonePlaceholder")}
              className={inputClass}
            />
          </Field>

          {isStudent && (
            <>
              <Field label={t("onboarding.create.course")}>
                <EditableDropdown
                  category="course"
                  options={courseOptions}
                  value={course}
                  onChange={setCourse}
                  placeholder={t("onboarding.create.selectPlaceholder")}
                />
              </Field>
              <Field label={t("onboarding.create.class")}>
                <EditableDropdown
                  category="class"
                  options={classOptions}
                  value={className}
                  onChange={setClassName}
                  placeholder={t("onboarding.create.selectPlaceholder")}
                />
              </Field>
              <Field label={t("onboarding.create.practicalBatch")}>
                <EditableDropdown
                  category="practical_batch"
                  options={batchOptions}
                  value={practicalBatch}
                  onChange={setPracticalBatch}
                  placeholder={t("onboarding.create.selectPlaceholder")}
                />
              </Field>
            </>
          )}

          <Field label={t("onboarding.editUser.status")} htmlFor="eu-status">
            <select
              id="eu-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as UserRow["status"])}
              disabled={isSelf}
              className={`${inputClass} disabled:cursor-not-allowed disabled:opacity-60`}
            >
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS_LABEL_KEY[s])}
                </option>
              ))}
            </select>
            {isSelf && (
              <p className="mt-1 text-xs text-muted">
                {t("onboarding.editUser.selfNote")}
              </p>
            )}
          </Field>

          {error && (
            <p className="rounded-md border border-danger/40 bg-lavender px-3 py-2 text-sm text-danger">
              {t(`onboarding.errors.${error}`)}
              {fieldErrorSuffix(fieldErrors)}
            </p>
          )}

          <div className="mt-auto flex items-center justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
            >
              {t("onboarding.create.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {pending
                ? t("onboarding.editUser.submitting")
                : t("onboarding.editUser.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal";

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
