"use client";

// Onboarding Hub — client orchestrator.
//
// Owns: the searchable / filterable user data grid, the "Add user" drawer, the
// "Import CSV" modal, and a tiny toast queue shared by both flows. All visible
// strings go through useT()/<Editable> so they honor Edit Mode text overrides.

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  Funnel,
  Plus,
  Search,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  Upload,
  X,
} from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import type { DropdownOptionItem } from "@/components/edit-mode/EditableDropdown";
import {
  bulkDeleteUsersAction,
  deleteUserAction,
} from "@/app/actions/onboarding";
import { saveUsersTablePreferencesAction } from "@/app/actions/preferences";
import type { Role } from "@/lib/auth/permissions";
import { EditUserDrawer } from "./EditUserDrawer";
import {
  sanitizeUsersTableLayout,
  type UsersTableLayout,
} from "@/lib/table-layout";
import { customColumnKey } from "@/lib/user-fields";
import { extractYear } from "@/lib/courses";
import { STUDY_YEARS, studyYearLabelKey } from "@/lib/academic-year";
import { ColumnManager } from "./ColumnManager";
import { CreateUserDrawer } from "./CreateUserDrawer";
import { CsvImport } from "./CsvImport";
import { UsersTable, type SelectionApi } from "./UsersTable";
import type { CustomField, Toast, ToastKind, UserRow } from "./types";

// The row/toast types moved to ./types so the table and the drawers can import
// them without pulling this orchestrator into their module graph. Re-exported
// here because CreateUserDrawer / CsvImport / EditUserDrawer import them from
// this path.
export type { UserRow, Toast, ToastKind } from "./types";

export function UsersContent({
  users,
  customFields,
  courseOptions,
  classOptions,
  batchOptions,
  canDelete,
  canManageColumns,
  canEditStudents,
  canCreateUsers,
  currentUserId,
  assignableRoles,
  savedLayout,
}: {
  users: UserRow[];
  // Live admin-defined columns. Drives the extra grid columns, the column
  // manager, and the import mapping targets.
  customFields: CustomField[];
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  batchOptions: DropdownOptionItem[];
  // Only Admins may delete — the column, the row buttons, and the bulk
  // selection rail are all hidden otherwise.
  canDelete: boolean;
  // `settings` holders (admin only) may create / rename / delete columns.
  // Presentation only: app/actions/user-fields.ts re-checks the same gate.
  canManageColumns: boolean;
  // manageUsers holders (admin / principal / office admin) may edit a user.
  canEditStudents: boolean;
  // Only Admins may create accounts outright — the "Add user" and "Import CSV"
  // buttons are hidden otherwise. Presentation only: the server actions behind
  // them enforce the same rule and reject anyone else regardless.
  canCreateUsers: boolean;
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
  const [yearFilter, setYearFilter] = useState(""); // year of study, "1".."4"
  const [admissionFilter, setAdmissionFilter] = useState(""); // e.g. "2024"
  // The filter panel is collapsed by default so the grid gets the full width;
  // a toolbar button opens it.
  const [filtersOpen, setFiltersOpen] = useState(false);
  const activeFilterCount = [
    roleFilter,
    courseFilter,
    classFilter,
    yearFilter,
    admissionFilter,
  ].filter(Boolean).length;
  const clearFilters = () => {
    setRoleFilter("");
    setCourseFilter("");
    setClassFilter("");
    setYearFilter("");
    setAdmissionFilter("");
  };

  // Admission years that actually occur, newest first, for the filter.
  const admissionYears = useMemo(
    () =>
      Array.from(
        new Set(
          users
            .map((u) => u.admissionYear)
            .filter((y): y is number => y != null),
        ),
      ).sort((a, b) => b - a),
    [users],
  );

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

  // --- Bulk selection (Phase 9) -------------------------------------------
  // Scope is ALWAYS the current filtered result set. There is deliberately no
  // "select every user in the database" affordance: the operator can only ever
  // act on rows they can see, so a selection can never quietly outgrow the
  // filter that produced it.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [bulkOpen, setBulkOpen] = useState(false);

  const [toasts, setToasts] = useState<Toast[]>([]);
  const notify = (kind: ToastKind, message: string) =>
    setToasts((prev) => [...prev, { id: Date.now() + Math.random(), kind, message }]);
  const dismiss = (id: number) =>
    setToasts((prev) => prev.filter((x) => x.id !== id));

  const router = useRouter();
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [editTarget, setEditTarget] = useState<UserRow | null>(null);
  const [deleting, startDelete] = useTransition();

  // Stable row callbacks — UsersTable memoizes each row, and a fresh arrow
  // function per render would defeat that for every row on every keystroke in
  // the search box.
  const openEdit = useCallback((user: UserRow) => setEditTarget(user), []);
  const openDelete = useCallback((user: UserRow) => setDeleteTarget(user), []);

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
            : result.error === "rateLimited"
              ? t("onboarding.errors.rateLimited")
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
    // Same whitelist the server applies, so the optimistic local layout and the
    // persisted one can never disagree about which columns exist.
    const clean = sanitizeUsersTableLayout(
      next,
      customFields.map((f) => customColumnKey(f.key)),
    );
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
      if (yearFilter && String(studyYearOf(u) ?? "") !== yearFilter) return false;
      if (admissionFilter && String(u.admissionYear ?? "") !== admissionFilter) {
        return false;
      }
      if (!q) return true;
      return (
        u.fullName.toLowerCase().includes(q) ||
        (u.studentId?.toLowerCase().includes(q) ?? false) ||
        (u.email?.toLowerCase().includes(q) ?? false)
      );
    });
  }, [
    users,
    search,
    roleFilter,
    courseFilter,
    classFilter,
    yearFilter,
    admissionFilter,
  ]);

  // CLEAR THE SELECTION WHENEVER THE RESULT SET MOVES.
  //
  // Without this, narrowing a filter would leave rows selected that are no
  // longer on screen, and the next "delete 12 selected" would hit accounts the
  // operator cannot see — the exact failure mode bulk actions are notorious
  // for. Clearing on every filter/search change is the blunt, safe rule: the
  // selection only ever describes what is currently visible.
  //
  // Done as a render-phase adjustment rather than in an effect, deliberately.
  // An effect would clear the selection one render LATE, so for a single frame
  // the toolbar would show a count belonging to the previous filter — and React
  // flags synchronous setState in an effect for exactly that reason. Comparing
  // a signature during render is the documented pattern for state that must
  // reset when an input changes; React re-runs this component immediately and
  // never commits the stale tree.
  // JSON, not a delimiter-joined string: a search box can contain any
  // character, so any separator picked by hand is a separator a user can type.
  const filterSignature = JSON.stringify([
    search,
    roleFilter,
    courseFilter,
    classFilter,
    yearFilter,
    admissionFilter,
  ]);
  const [lastFilterSignature, setLastFilterSignature] = useState(filterSignature);
  if (lastFilterSignature !== filterSignature) {
    setLastFilterSignature(filterSignature);
    if (selected.size > 0) setSelected(new Set());
  }

  // Only meaningful for someone who can actually act on a selection.
  const canSelect = canDelete;

  const toggleRow = useCallback((id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // "Select all" = every row in the CURRENT filtered set, nothing more.
  const toggleAllFiltered = useCallback(
    (checked: boolean) => {
      setSelected(checked ? new Set(filtered.map((u) => u.id)) : new Set());
    },
    [filtered],
  );

  const selection: SelectionApi | undefined = canSelect
    ? { selected, toggle: toggleRow, toggleAll: toggleAllFiltered }
    : undefined;

  // Guard against a stale id surviving a data refresh (a row deleted in another
  // tab). The toolbar count and the delete payload both read from this.
  const selectedRows = useMemo(
    () => filtered.filter((u) => selected.has(u.id)),
    [filtered, selected],
  );

  const [bulkDeleting, startBulkDelete] = useTransition();

  const confirmBulkDelete = () => {
    const ids = selectedRows.map((u) => u.id);
    if (ids.length === 0) return;
    startBulkDelete(async () => {
      const result = await bulkDeleteUsersAction(ids);
      if (!result.ok) {
        notify(
          "error",
          result.error === "rateLimited"
            ? t("onboarding.errors.rateLimited")
            : result.error === "forbidden"
              ? t("onboarding.errors.forbidden")
              : t("onboarding.errors.unknown"),
        );
        return;
      }
      // Report BOTH halves. A bare "deleted 9" after asking for 12 is exactly
      // the ambiguous partial state this flow exists to avoid.
      if (result.failed.length === 0) {
        notify(
          "success",
          t("onboarding.bulk.deleted", { count: result.deleted.length }),
        );
      } else {
        notify(
          result.deleted.length > 0 ? "success" : "error",
          t("onboarding.bulk.deletedWithErrors", {
            count: result.deleted.length,
            failed: result.failed.length,
            names: result.failed
              .slice(0, 3)
              .map((f) => f.name)
              .join(", "),
          }),
        );
      }
      setSelected(new Set());
      setBulkOpen(false);
      router.refresh();
    });
  };

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
          {canCreateUsers && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Search + filter toggle. Filters live behind a button so the grid
          keeps the full page width when they aren't needed. */}
      <section className="min-w-0">
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative min-w-60 flex-1">
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
          <button
            type="button"
            onClick={() => setFiltersOpen((open) => !open)}
            aria-expanded={filtersOpen}
            aria-controls="users-filters"
            className={`inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-sm font-medium hover:bg-lavender ${
              activeFilterCount > 0
                ? "border-primary/40 bg-lavender text-primary"
                : "border-line bg-surface text-ink"
            }`}
          >
            <Funnel className="size-4" aria-hidden />
            {t("onboarding.filters")}
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-foreground [font-variant-numeric:tabular-nums]">
                {activeFilterCount}
              </span>
            )}
            <ChevronDown
              className={`size-4 transition-transform ${filtersOpen ? "rotate-180" : ""}`}
              aria-hidden
            />
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="cursor-pointer text-sm font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {t("onboarding.clearFilters")}
            </button>
          )}
        </div>

        {filtersOpen && (
          <div
            id="users-filters"
            className="mb-4 grid gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5"
          >
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
              label={t("onboarding.filterYear")}
              value={yearFilter}
              onChange={setYearFilter}
              allLabel={t("onboarding.allYears")}
              options={STUDY_YEARS.map((y) => ({
                value: String(y),
                label: t(studyYearLabelKey(y)),
              }))}
            />
            <FilterSelect
              label={t("onboarding.filterAdmissionYear")}
              value={admissionFilter}
              onChange={setAdmissionFilter}
              allLabel={t("onboarding.allAdmissionYears")}
              options={admissionYears.map((y) => ({
                value: String(y),
                label: String(y),
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
        )}

        <p className="mb-3 text-sm font-medium text-muted [font-variant-numeric:tabular-nums]">
          {filtered.length === 1
            ? t("onboarding.resultsCountSingular")
            : t("onboarding.resultsCountPlural", { count: filtered.length })}
        </p>

        {/* Persistent selection toolbar. Present whenever anything is
            selected, and it never leaves the filter's scope ambiguous — the
            count always reads "N of M filtered". */}
        {canSelect && selectedRows.length > 0 && (
          <div className="mb-3 flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-lavender px-4 py-3">
            <span className="text-sm font-semibold text-primary [font-variant-numeric:tabular-nums]">
              {t("onboarding.bulk.selectedCount", {
                count: selectedRows.length,
                total: filtered.length,
              })}
            </span>
            {selectedRows.length < filtered.length && (
              <button
                type="button"
                onClick={() => toggleAllFiltered(true)}
                className="cursor-pointer text-sm font-medium text-teal underline-offset-2 hover:underline"
              >
                {t("onboarding.bulk.selectAllFiltered", {
                  count: filtered.length,
                })}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="cursor-pointer text-sm font-medium text-muted underline-offset-2 hover:text-ink hover:underline"
            >
              {t("onboarding.bulk.clear")}
            </button>
            <span className="ml-auto flex items-center gap-3">
              {/* The scope is spelled out again next to the destructive
                  button, because that is where it actually matters. */}
              <span className="hidden text-xs text-muted sm:inline">
                {t("onboarding.bulk.scopeNote")}
              </span>
              <button
                type="button"
                onClick={() => setBulkOpen(true)}
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-danger px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
              >
                <Trash2 className="size-3.5" />
                {t("onboarding.bulk.deleteSelected", {
                  count: selectedRows.length,
                })}
              </button>
            </span>
          </div>
        )}

        <UsersTable
          rows={filtered}
          columns={visibleColumns}
          customFields={customFields}
          totalCount={users.length}
          canEditStudents={canEditStudents}
          canDelete={canDelete}
          onEdit={openEdit}
          onDelete={openDelete}
          selection={selection}
        />

        <p className="mt-3 text-xs text-muted">
          {t("onboarding.showing", {
            count: filtered.length,
            total: users.length,
          })}
        </p>
      </section>

      {drawerOpen && canCreateUsers && (
        <CreateUserDrawer
          courseOptions={courseOptions}
          classOptions={classOptions}
          batchOptions={batchOptions}
          assignableRoles={assignableRoles}
          onClose={() => setDrawerOpen(false)}
          notify={notify}
        />
      )}

      {csvOpen && canCreateUsers && (
        <CsvImport onClose={() => setCsvOpen(false)} notify={notify} />
      )}

      {editTarget && (
        <EditUserDrawer
          user={editTarget}
          isSelf={editTarget.id === currentUserId}
          courseOptions={courseOptions}
          classOptions={classOptions}
          batchOptions={batchOptions}
          customFields={customFields}
          onClose={() => setEditTarget(null)}
          notify={notify}
        />
      )}

      {configOpen && (
        <ColumnManager
          layout={layout}
          customFields={customFields}
          canManageColumns={canManageColumns}
          saving={savingLayout}
          onCancel={() => setConfigOpen(false)}
          onSave={saveLayout}
          notify={notify}
          // A definition change is global and already committed server-side;
          // refreshing re-runs the page query so the new column list, the
          // re-sanitized layout, and the cell values all arrive together.
          onFieldsChanged={() => router.refresh()}
        />
      )}

      {bulkOpen && (
        <BulkDeleteConfirm
          users={selectedRows}
          pending={bulkDeleting}
          onCancel={() => setBulkOpen(false)}
          onConfirm={confirmBulkDelete}
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

/**
 * Bulk-delete confirmation.
 *
 * This is the most destructive action in the console — it cascades across
 * tickets, ledgers, attendance and custom values for every selected account,
 * and there is no undo. So it does three things a plain "Are you sure?" does
 * not:
 *
 *   1. States the EXACT count, and lists the accounts (scrollable) so the
 *      operator can see what they actually selected rather than a number.
 *   2. Requires typing that count. A second click is muscle memory; typing "12"
 *      is a deliberate act, and it forces the operator to read the number.
 *   3. Says plainly that it is permanent and names what else goes with it.
 */
function BulkDeleteConfirm({
  users,
  pending,
  onCancel,
  onConfirm,
}: {
  users: UserRow[];
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const confirmed = typed.trim() === String(users.length);

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
        className="relative flex max-h-[85vh] w-full max-w-md flex-col rounded-lg border border-line bg-surface p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-danger/10 p-2 text-danger">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">
              {t("onboarding.bulk.confirmTitle", { count: users.length })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("onboarding.bulk.confirmBody", { count: users.length })}
            </p>
            <p className="mt-2 text-sm font-medium text-danger">
              {t("onboarding.bulk.irreversible")}
            </p>
          </div>
        </div>

        <ul className="mt-4 max-h-40 overflow-y-auto rounded-md border border-line bg-canvas px-3 py-2 text-sm">
          {users.map((u) => (
            <li key={u.id} className="truncate py-0.5 text-ink">
              {u.fullName}
              {u.studentId && (
                <span className="text-muted"> - {u.studentId}</span>
              )}
            </li>
          ))}
        </ul>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-ink">
            {t("onboarding.bulk.typeCount", { count: users.length })}
          </span>
          <input
            autoFocus
            inputMode="numeric"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="cursor-pointer rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || !confirmed}
            className="cursor-pointer rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? t("onboarding.deleting")
              : t("onboarding.bulk.deleteSelected", { count: users.length })}
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

/**
 * A student's year of study (1–4): the stored value, or — for rows imported
 * before it was derived — read out of the class text ("First Year" -> 1).
 */
function studyYearOf(u: UserRow): number | null {
  return u.year ?? extractYear(u.className).year;
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
    <div className="pointer-events-none fixed bottom-4 right-4 z-60 flex w-full max-w-xs flex-col gap-2">
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
