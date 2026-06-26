"use client";

// Onboarding Hub — client orchestrator.
//
// Owns: the searchable / filterable user data grid, the "Add user" drawer, the
// "Import CSV" modal, and a tiny toast queue shared by both flows. All visible
// strings go through useT()/<Editable> so they honor Edit Mode text overrides.

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Upload, X } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import type { DropdownOptionItem } from "@/components/edit-mode/EditableDropdown";
import { CreateUserDrawer } from "./CreateUserDrawer";
import { CsvImport } from "./CsvImport";

export type UserRow = {
  id: number;
  fullName: string;
  studentId: string | null;
  email: string | null;
  phone: string | null;
  role: "admin" | "teacher" | "student";
  course: string | null;
  className: string | null;
  status: "pending" | "active" | "rejected";
};

export type ToastKind = "success" | "error";
export type Toast = { id: number; kind: ToastKind; message: string };

const ROLE_LABEL: Record<UserRow["role"], string> = {
  admin: "onboarding.roleAdmin",
  teacher: "onboarding.roleTeacher",
  student: "onboarding.roleStudent",
};

const STATUS_LABEL: Record<UserRow["status"], string> = {
  active: "onboarding.statusActive",
  pending: "onboarding.statusPending",
  rejected: "onboarding.statusRejected",
};

const STATUS_STYLE: Record<UserRow["status"], string> = {
  active: "bg-mint text-teal",
  pending: "bg-lavender text-primary",
  rejected: "bg-lavender text-danger",
};

export function UsersContent({
  users,
  courseOptions,
  classOptions,
  batchOptions,
}: {
  users: UserRow[];
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  batchOptions: DropdownOptionItem[];
}) {
  const t = useT();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (kind: ToastKind, message: string) =>
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), kind, message }]);
  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (roleFilter && u.role !== roleFilter) return false;
      if (courseFilter && u.course !== courseFilter) return false;
      if (classFilter && u.className !== classFilter) return false;
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        (u.studentId?.toLowerCase().includes(q) ?? false) ||
        (u.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [users, search, roleFilter, courseFilter, classFilter]);

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            <Editable tKey="onboarding.title" />
          </h1>
          <p className="mt-1 text-sm text-muted">
            <Editable tKey="onboarding.subtitle" />
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setCsvOpen(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            <Upload className="size-4" /> {t("onboarding.importCsv")}
          </button>
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            <Plus className="size-4" /> {t("onboarding.addUser")}
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Sidebar filters */}
        <aside className="w-full shrink-0 lg:w-60">
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <h2 className="mb-3 text-sm font-semibold text-ink">
              {t("onboarding.filters")}
            </h2>
            <div className="flex flex-col gap-3">
              <FilterSelect
                label={t("onboarding.filterRole")}
                value={roleFilter}
                onChange={setRoleFilter}
                allLabel={t("onboarding.allRoles")}
                options={[
                  { value: "student", label: t("onboarding.roleStudent") },
                  { value: "teacher", label: t("onboarding.roleTeacher") },
                  { value: "admin", label: t("onboarding.roleAdmin") },
                ]}
              />
              <FilterSelect
                label={t("onboarding.filterCourse")}
                value={courseFilter}
                onChange={setCourseFilter}
                allLabel={t("onboarding.allCourses")}
                options={courseOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
              <FilterSelect
                label={t("onboarding.filterClass")}
                value={classFilter}
                onChange={setClassFilter}
                allLabel={t("onboarding.allClasses")}
                options={classOptions.map((o) => ({
                  value: o.value,
                  label: o.label,
                }))}
              />
            </div>
          </div>
        </aside>

        {/* Main: search + table */}
        <section className="min-w-0 flex-1">
          <div className="relative mb-4">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("onboarding.searchPlaceholder")}
              aria-label={t("onboarding.searchPlaceholder")}
              className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink focus:border-teal"
            />
          </div>

          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                    <Th>{t("onboarding.colName")}</Th>
                    <Th>{t("onboarding.colRollNo")}</Th>
                    <Th>{t("onboarding.colEmail")}</Th>
                    <Th>{t("onboarding.colPhone")}</Th>
                    <Th>{t("onboarding.colRole")}</Th>
                    <Th>{t("onboarding.colCourse")}</Th>
                    <Th>{t("onboarding.colClass")}</Th>
                    <Th>{t("onboarding.colStatus")}</Th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-sm text-muted"
                      >
                        {t("onboarding.noResults")}
                      </td>
                    </tr>
                  ) : (
                    filtered.map((u) => (
                      <tr
                        key={u.id}
                        className="border-b border-line last:border-0 hover:bg-canvas"
                      >
                        <td className="px-4 py-3 font-medium text-ink">
                          {u.fullName}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {u.studentId ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {u.email ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {u.phone ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-ink">
                          {t(ROLE_LABEL[u.role])}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {u.course ?? "—"}
                        </td>
                        <td className="px-4 py-3 text-muted">
                          {u.className ?? "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[u.status]}`}
                          >
                            {t(STATUS_LABEL[u.status])}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="mt-3 text-xs text-muted">
            {t("onboarding.showing", {
              count: filtered.length,
              total: users.length,
            })}
          </p>
        </section>
      </div>

      {drawerOpen && (
        <CreateUserDrawer
          courseOptions={courseOptions}
          classOptions={classOptions}
          batchOptions={batchOptions}
          onClose={() => setDrawerOpen(false)}
          notify={notify}
        />
      )}

      {csvOpen && (
        <CsvImport onClose={() => setCsvOpen(false)} notify={notify} />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

function FilterSelect({
  label,
  value,
  onChange,
  allLabel,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  allLabel: string;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
      >
        <option value="">{allLabel}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Auto-dismissing toast stack (fixed, bottom-right). */
function ToastStack({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-xs flex-col gap-2">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), 5000);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-md ${
        toast.kind === "success"
          ? "border-teal/40 bg-mint text-ink"
          : "border-danger/40 bg-lavender text-ink"
      }`}
    >
      <span className="flex-1">{toast.message}</span>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="rounded p-0.5 text-muted hover:text-ink"
        aria-label="Dismiss"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
