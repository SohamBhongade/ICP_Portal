"use client";

// Onboarding Hub — client orchestrator.
//
// Owns: the searchable / filterable user data grid, the "Add user" drawer, the
// "Import CSV" modal, and a tiny toast queue shared by both flows. All visible
// strings go through useT()/<Editable> so they honor Edit Mode text overrides.

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import type { DropdownOptionItem } from "@/components/edit-mode/EditableDropdown";
import { deleteUserAction } from "@/app/actions/onboarding";
import { saveUsersTablePreferencesAction } from "@/app/actions/preferences";
import type { Role } from "@/lib/auth/permissions";
import { EditUserDrawer } from "./EditUserDrawer";
import {
  DEFAULT_USERS_TABLE_LAYOUT,
  USERS_COLUMN_LABEL_KEY,
  sanitizeUsersTableLayout,
  type UsersColumnKey,
  type UsersTableLayout,
} from "@/lib/table-layout";
import { CreateUserDrawer } from "./CreateUserDrawer";
import { CsvImport } from "./CsvImport";

export type UserRow = {
  id: number;
  fullName: string;
  studentId: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  course: string | null;
  className: string | null;
  practicalBatch: string | null;
  status: "pending" | "active" | "rejected";
  // Joined date — a Date across the RSC boundary, but tolerate string/number.
  createdAt: Date | string | number | null;
};

type Translator = ReturnType<typeof useT>;

export type ToastKind = "success" | "error";
export type Toast = { id: number; kind: ToastKind; message: string };

const ROLE_LABEL: Record<Role, string> = {
  admin: "onboarding.roleAdmin",
  principal: "onboarding.rolePrincipal",
  "office admin": "onboarding.roleOfficeAdmin",
  faculty: "onboarding.roleFaculty",
  staff: "onboarding.roleStaff",
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
  canDelete,
  canEditStudents,
  currentUserId,
  assignableRoles,
  savedLayout,
}: {
  users: UserRow[];
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  batchOptions: DropdownOptionItem[];
  // Only Admins may delete — the column + button are hidden otherwise.
  canDelete: boolean;
  // manageUsers holders (admin / principal / office admin) may edit a user.
  canEditStudents: boolean;
  // The signed-in user's id — used to lock status editing on your own account.
  currentUserId: number;
  // Roles the current actor is allowed to create (anti-escalation).
  assignableRoles: Role[];
  // The current user's saved column layout (order + visibility), already
  // sanitized server-side. Drives the initial column render.
  savedLayout: UsersTableLayout;
}) {
  const t = useT();

  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [courseFilter, setCourseFilter] = useState("");
  const [classFilter, setClassFilter] = useState("");

  const [drawerOpen, setDrawerOpen] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);

  // --- Dynamic column layout ---------------------------------------------
  // `layout` is the live column config; the config panel edits a draft copy and
  // only commits on save (which also persists to the DB via the server action).
  const [layout, setLayout] = useState<UsersTableLayout>(savedLayout);
  const [configOpen, setConfigOpen] = useState(false);
  const visibleColumns = useMemo(
    () => layout.filter((c) => c.visible).map((c) => c.key),
    [layout],
  );

  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (kind: ToastKind, message: string) =>
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), kind, message }]);
  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [deleting, startDelete] = useTransition();

  // Whether the row-actions column renders at all (Edit and/or Delete).
  const canManage = canEditStudents || canDelete;

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const target = deleteTarget;
    startDelete(async () => {
      const result = await deleteUserAction(target.id);
      if (result.ok) {
        notify(
          "success",
          t("onboarding.toast.deleted", { name: target.fullName }),
        );
      } else {
        notify(
          "error",
          result.error === "self"
            ? t("onboarding.toast.cannotDeleteSelf")
            : t("onboarding.toast.deleteFailed"),
        );
      }
      setDeleteTarget(null);
      router.refresh();
    });
  };

  const [savingLayout, startSaveLayout] = useTransition();

  // Commit a draft layout: update the grid immediately (optimistic) and persist
  // it to the user's account. On failure we surface a toast but keep the local
  // change so the admin isn't blocked; a refresh would re-hydrate the saved one.
  const saveLayout = (next: UsersTableLayout) => {
    const clean = sanitizeUsersTableLayout(next);
    setLayout(clean);
    setConfigOpen(false);
    startSaveLayout(async () => {
      const result = await saveUsersTablePreferencesAction(clean);
      notify(
        result.ok ? "success" : "error",
        result.ok ? t("onboarding.columns.saved") : t("onboarding.columns.saveFailed"),
      );
    });
  };

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
            onClick={() => setConfigOpen(true)}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            <SlidersHorizontal className="size-4" /> {t("onboarding.editColumns")}
          </button>
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
                  { value: "faculty", label: t("onboarding.roleFaculty") },
                  { value: "staff", label: t("onboarding.roleStaff") },
                  { value: "office admin", label: t("onboarding.roleOfficeAdmin") },
                  { value: "principal", label: t("onboarding.rolePrincipal") },
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

          <p className="mb-3 text-sm font-medium text-muted [font-variant-numeric:tabular-nums]">
            {filtered.length === 1
              ? t("onboarding.resultsCountSingular")
              : t("onboarding.resultsCountPlural", { count: filtered.length })}
          </p>

          <div className="overflow-hidden rounded-lg border border-line bg-surface shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                    {/* Name is the identity anchor — always first, not toggleable. */}
                    <Th>{t("onboarding.colName")}</Th>
                    {visibleColumns.map((key) => (
                      <Th key={key}>{t(USERS_COLUMN_LABEL_KEY[key])}</Th>
                    ))}
                    {canManage && <Th>{t("onboarding.colActions")}</Th>}
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 ? (
                    <tr>
                      <td
                        colSpan={1 + visibleColumns.length + (canManage ? 1 : 0)}
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
                        {visibleColumns.map((key) => (
                          <UserCell key={key} column={key} user={u} t={t} />
                        ))}
                        {canManage && (
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              {canEditStudents && (
                                <button
                                  type="button"
                                  onClick={() => setEditTarget(u)}
                                  aria-label={t("onboarding.edit")}
                                  title={t("onboarding.edit")}
                                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:border-teal hover:bg-lavender"
                                >
                                  <Pencil className="size-3.5" />
                                  <span className="hidden sm:inline">
                                    {t("onboarding.edit")}
                                  </span>
                                </button>
                              )}
                              {canDelete && (
                                <button
                                  type="button"
                                  onClick={() => setDeleteTarget(u)}
                                  aria-label={t("onboarding.delete")}
                                  title={t("onboarding.delete")}
                                  className="inline-flex items-center gap-1 rounded-md border border-line px-2 py-1 text-xs font-medium text-danger hover:border-danger/40 hover:bg-danger/10"
                                >
                                  <Trash2 className="size-3.5" />
                                  <span className="hidden sm:inline">
                                    {t("onboarding.delete")}
                                  </span>
                                </button>
                              )}
                            </div>
                          </td>
                        )}
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
          assignableRoles={assignableRoles}
          onClose={() => setDrawerOpen(false)}
          notify={notify}
        />
      )}

      {csvOpen && (
        <CsvImport onClose={() => setCsvOpen(false)} notify={notify} />
      )}

      {editTarget && (
        <EditUserDrawer
          user={editTarget}
          isSelf={editTarget.id === currentUserId}
          courseOptions={courseOptions}
          classOptions={classOptions}
          batchOptions={batchOptions}
          onClose={() => setEditTarget(null)}
          notify={notify}
        />
      )}

      {configOpen && (
        <ColumnConfig
          layout={layout}
          saving={savingLayout}
          onCancel={() => setConfigOpen(false)}
          onSave={saveLayout}
        />
      )}

      {deleteTarget && (
        <DeleteConfirm
          user={deleteTarget}
          pending={deleting}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={confirmDelete}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismiss} />
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="whitespace-nowrap px-4 py-3 font-medium">{children}</th>;
}

/** Format a joined date defensively — the value crosses the RSC boundary and
 *  may arrive as a Date, an ISO string, or an epoch number. */
function formatJoined(value: Date | string | number | null): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

/** Renders a single <td> for one customizable column. The Name column and the
 *  row-actions column are rendered inline in UsersContent (they're structural). */
function UserCell({
  column,
  user: u,
  t,
}: {
  column: UsersColumnKey;
  user: UserRow;
  t: Translator;
}) {
  switch (column) {
    case "rollNo":
      return <td className="px-4 py-3 text-muted">{u.studentId ?? "—"}</td>;
    case "email":
      return <td className="px-4 py-3 text-muted">{u.email ?? "—"}</td>;
    case "phone":
      return <td className="px-4 py-3 text-muted">{u.phone ?? "—"}</td>;
    case "role":
      return <td className="px-4 py-3 text-ink">{t(ROLE_LABEL[u.role])}</td>;
    case "course":
      return <td className="px-4 py-3 text-muted">{u.course ?? "—"}</td>;
    case "className":
      return <td className="px-4 py-3 text-muted">{u.className ?? "—"}</td>;
    case "status":
      return (
        <td className="px-4 py-3">
          <span
            className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[u.status]}`}
          >
            {t(STATUS_LABEL[u.status])}
          </span>
        </td>
      );
    case "joinedDate":
      return (
        <td className="px-4 py-3 text-muted [font-variant-numeric:tabular-nums]">
          {formatJoined(u.createdAt)}
        </td>
      );
  }
}

/**
 * Column customization panel. Edits a DRAFT copy of the layout (order +
 * visibility) so nothing changes until "Save" — which persists to the user's
 * account. Reordering uses up/down arrows (no drag-drop dependency); visibility
 * uses a checkbox per row. "Restore defaults" resets the draft to every column
 * visible in the canonical order.
 */
function ColumnConfig({
  layout,
  saving,
  onCancel,
  onSave,
}: {
  layout: UsersTableLayout;
  saving: boolean;
  onCancel: () => void;
  onSave: (next: UsersTableLayout) => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<UsersTableLayout>(layout);

  const toggle = (index: number) =>
    setDraft((prev) =>
      prev.map((c, i) => (i === index ? { ...c, visible: !c.visible } : c)),
    );

  const move = (index: number, dir: -1 | 1) =>
    setDraft((prev) => {
      const target = index + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });

  const visibleCount = draft.filter((c) => c.visible).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onCancel}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-line bg-surface shadow-xl"
      >
        <div className="flex items-start gap-3 border-b border-line p-5">
          <span className="rounded-full bg-lavender p-2 text-primary">
            <SlidersHorizontal className="size-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-ink">
              {t("onboarding.columns.title")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("onboarding.columns.hint")}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t("common.cancel")}
            className="rounded p-1 text-muted hover:text-ink"
          >
            <X className="size-4" />
          </button>
        </div>

        <ul className="flex-1 overflow-y-auto p-3">
          {draft.map((col, i) => (
            <li
              key={col.key}
              className="flex items-center gap-3 rounded-md px-2 py-2 hover:bg-canvas"
            >
              <label className="flex flex-1 cursor-pointer items-center gap-3">
                <input
                  type="checkbox"
                  checked={col.visible}
                  onChange={() => toggle(i)}
                  className="size-4 accent-primary"
                />
                <span
                  className={`text-sm font-medium ${col.visible ? "text-ink" : "text-muted"}`}
                >
                  {t(USERS_COLUMN_LABEL_KEY[col.key])}
                </span>
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={t("onboarding.columns.moveUp")}
                  title={t("onboarding.columns.moveUp")}
                  className="rounded border border-line p-1 text-muted hover:bg-lavender hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowUp className="size-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === draft.length - 1}
                  aria-label={t("onboarding.columns.moveDown")}
                  title={t("onboarding.columns.moveDown")}
                  className="rounded border border-line p-1 text-muted hover:bg-lavender hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ArrowDown className="size-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>

        <div className="flex items-center justify-between gap-2 border-t border-line p-4">
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_USERS_TABLE_LAYOUT)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            <RotateCcw className="size-3.5" /> {t("onboarding.columns.restore")}
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving || visibleCount === 0}
            title={
              visibleCount === 0 ? t("onboarding.columns.needOne") : undefined
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {saving ? t("onboarding.columns.saving") : t("onboarding.columns.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Centered confirm dialog for the destructive delete action. */
function DeleteConfirm({
  user,
  pending,
  onCancel,
  onConfirm,
}: {
  user: UserRow;
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onCancel}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-lg border border-line bg-surface p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-danger/10 p-2 text-danger">
            <Trash2 className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">
              {t("onboarding.deleteTitle")}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("onboarding.deleteBody", { name: user.fullName })}
            </p>
          </div>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {pending ? t("onboarding.deleting") : t("onboarding.delete")}
          </button>
        </div>
      </div>
    </div>
  );
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
