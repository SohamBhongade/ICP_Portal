"use client";

// Manual single-account creation — a right-hand slide-over drawer.
//
// Role toggle switches the field set: students get a roll number + Course /
// Class / Practical-batch (sourced from <EditableDropdown>, so Edit Mode can
// manage those options inline); staff (teacher/admin) only need an email.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  EditableDropdown,
  type DropdownOptionItem,
} from "@/components/edit-mode/EditableDropdown";
import {
  createUserAction,
  type ActionError,
  type OnboardRole,
} from "@/app/actions/onboarding";
import type { Role } from "@/lib/auth/permissions";
import type { ToastKind } from "./UsersContent";

// Translation keys per role (mirrors ROLE_LABEL in UsersContent).
const ROLE_LABEL_KEY: Record<Role, string> = {
  admin: "onboarding.roleAdmin",
  principle: "onboarding.rolePrinciple",
  "office admin": "onboarding.roleOfficeAdmin",
  faculty: "onboarding.roleFaculty",
  staff: "onboarding.roleStaff",
  student: "onboarding.roleStudent",
};

export function CreateUserDrawer({
  courseOptions,
  classOptions,
  batchOptions,
  assignableRoles,
  onClose,
  notify,
}: {
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  batchOptions: DropdownOptionItem[];
  assignableRoles: Role[];
  onClose: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<ActionError | null>(null);

  // Default to student when allowed, else the first assignable role.
  const [role, setRole] = useState<OnboardRole>(
    assignableRoles.includes("student") ? "student" : assignableRoles[0],
  );
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [studentId, setStudentId] = useState("");
  const [course, setCourse] = useState("");
  const [className, setClassName] = useState("");
  const [practicalBatch, setPracticalBatch] = useState("");

  const isStudent = role === "student";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    startTransition(async () => {
      const result = await createUserAction({
        role,
        fullName,
        email,
        phone,
        studentId,
        course,
        className,
        practicalBatch,
      });
      if (result.ok) {
        notify(
          "success",
          t("onboarding.toast.created", { name: fullName.trim() }),
        );
        router.refresh();
        onClose();
      } else {
        setError(result.error);
        notify("error", t("onboarding.toast.createFailed"));
      }
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      {/* Overlay */}
      <button
        type="button"
        aria-label={t("onboarding.create.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />

      {/* Panel */}
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex h-full w-full max-w-md flex-col overflow-y-auto bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            <Editable tKey="onboarding.create.title" />
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
          <Field label={t("onboarding.create.roleLabel")} htmlFor="cu-role">
            <select
              id="cu-role"
              value={role}
              onChange={(e) => setRole(e.target.value as OnboardRole)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
            >
              {assignableRoles.map((r) => (
                <option key={r} value={r}>
                  {t(ROLE_LABEL_KEY[r])}
                </option>
              ))}
            </select>
          </Field>

          <Field label={t("onboarding.create.fullName")} htmlFor="cu-name">
            <input
              id="cu-name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder={t("onboarding.create.fullNamePlaceholder")}
              required
              className={inputClass}
            />
          </Field>

          {isStudent && (
            <Field label={t("onboarding.create.rollNo")} htmlFor="cu-roll">
              <input
                id="cu-roll"
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
            htmlFor="cu-email"
            optional={isStudent ? t("onboarding.create.optional") : undefined}
          >
            <input
              id="cu-email"
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
            htmlFor="cu-phone"
            optional={t("onboarding.create.optional")}
          >
            <input
              id="cu-phone"
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

          {error && (
            <p className="rounded-md border border-danger/40 bg-lavender px-3 py-2 text-sm text-danger">
              {t(`onboarding.errors.${error}`)}
            </p>
          )}

          <p className="text-xs text-muted">
            {t("onboarding.create.tempPasswordNote")}
          </p>

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
                ? t("onboarding.create.submitting")
                : t("onboarding.create.submit")}
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
