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
  Upload,
  X,
} from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import type { DropdownOptionItem } from "@/components/edit-mode/EditableDropdown";
import {
  bulkDeleteUsersAction,
  bulkUpdateUsersAction,
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
import {
  BulkActionBar,
  BulkDeleteConfirm,
  BulkEditModal,
  bulkChangePayload,
  bulkUpdateErrorMessage,
  captureGridScroll,
  optimisticPatch,
  restoreGridScroll,
  type BulkTarget,
} from "./BulkActions";
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

  // --- Optimistic overlay for bulk field edits -----------------------------
  //
  // A bulk "Change class" touches up to 500 rows. Waiting for the server round
  // trip AND the RSC refresh before anything moves makes the console feel
  // broken, so the patch is applied locally the moment the action is fired and
  // every read below goes through `rows` rather than the `users` prop.
  //
  // ROLLBACK is the whole reason this is a separate patch map rather than a
  // rewritten copy of `users`: on failure we drop the patch and the server's
  // rows reappear untouched, with nothing to reconstruct.
  //
  // The patch is also dropped whenever a fresh `users` array arrives, because
  // at that point the server has spoken and the overlay can only be stale or
  // redundant. Compared during render (the same pattern the filter signature
  // below uses) rather than in an effect, so the grid never paints one frame of
  // optimistic data over already-refreshed rows.
  const [optimistic, setOptimistic] = useState<Map<number, Partial<UserRow>>>(
    () => new Map(),
  );
  const [lastUsers, setLastUsers] = useState(users);
  if (lastUsers !== users) {
    setLastUsers(users);
    if (optimistic.size > 0) setOptimistic(new Map());
  }

  const rows = useMemo(() => {
    if (optimistic.size === 0) return users;
    return users.map((u) => {
      const patch = optimistic.get(u.id);
      if (!patch) return u;
      // `custom` is merged rather than replaced: a patch only ever names the
      // one column that changed.
      return {
        ...u,
        ...patch,
        custom: { ...u.custom, ...(patch.custom ?? {}) },
      };
    });
  }, [users, optimistic]);

  // Admission years that actually occur, newest first, for the filter.
  const admissionYears = useMemo(
    () =>
      Array.from(
        new Set(
          rows
            .map((u) => u.admissionYear)
            .filter((y): y is number => y != null),
        ),
      ).sort((a, b) => b - a),
    [rows],
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
  // Which "Change X" modal is open, if any.
  const [bulkEdit, setBulkEdit] = useState<BulkTarget | null>(null);

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
    return rows.filter((u) => {
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
    rows,
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

  // Only meaningful for someone who can actually act on a selection. Editing
  // fields in bulk is `manageUsers` work, deleting is `deleteUsers` work, so
  // holding EITHER is reason enough to be offered the checkboxes.
  const canSelect = canDelete || canEditStudents;

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

  // --- Bulk field edits ----------------------------------------------------
  //
  // One entry per thing the operator can change across a selection: the three
  // built-in student fields, then one per admin-defined column. Custom columns
  // are included rather than special-cased so "Change Year of Leaving" needs no
  // code of its own — it is simply the column the admin created, and any column
  // they add later gets a button for free.
  const bulkTargets = useMemo<BulkTarget[]>(() => {
    const builtIn: BulkTarget[] = [
      { kind: "className", label: t("onboarding.create.class") },
      { kind: "course", label: t("onboarding.create.course") },
      { kind: "admissionYear", label: t("onboarding.create.admissionYear") },
    ];
    // An admin can create a custom column whose label matches a built-in field
    // — this installation has both a built-in "Year of admission" and a custom
    // one. Two identically-labelled buttons that write to different places is
    // the worst possible outcome, so a colliding custom column is tagged.
    const builtInLabels = new Set(builtIn.map((b) => b.label.toLowerCase()));
    const custom = customFields.map((field): BulkTarget => {
      const collides = builtInLabels.has(field.label.toLowerCase());
      return {
        kind: "custom",
        field,
        label: collides
          ? `${field.label} (${t("onboarding.csv.customTag")})`
          : field.label,
      };
    });
    return [...builtIn, ...custom];
  }, [customFields, t]);

  const [bulkUpdating, startBulkUpdate] = useTransition();

  /**
   * Apply one field change to every selected row.
   *
   * Order matters: patch locally, fire, then either confirm (refresh, which
   * drops the patch when the new rows land) or roll back. The scroll offset is
   * captured before and restored after, because the refresh re-renders several
   * hundred rows and an operator who acted on row 380 must not be thrown back
   * to row 1.
   */
  const applyBulkChange = (target: BulkTarget, rawValue: string) => {
    const ids = selectedRows.map((u) => u.id);
    if (ids.length === 0) return;
    const scroll = captureGridScroll();

    setOptimistic((prev) => {
      const next = new Map(prev);
      const patch = optimisticPatch(target, rawValue);
      for (const id of ids) next.set(id, { ...(next.get(id) ?? {}), ...patch });
      return next;
    });

    startBulkUpdate(async () => {
      const result = await bulkUpdateUsersAction({
        ids,
        change: bulkChangePayload(target, rawValue),
      });

      if (!result.ok) {
        // ROLL BACK. Dropping the whole patch is correct even though only this
        // one change failed: a patch only ever exists while an action is in
        // flight, and there is never more than one in flight.
        setOptimistic(new Map());
        notify("error", bulkUpdateErrorMessage(result.error, target.label, t));
        return;
      }

      // Report both halves, the same way the bulk delete does — "changed 9"
      // after asking for 12 is the ambiguous partial state to avoid.
      notify(
        result.skipped.length === 0 ? "success" : "error",
        result.skipped.length === 0
          ? t("onboarding.bulk.changed", {
              count: result.updated,
              field: target.label,
            })
          : t("onboarding.bulk.changedWithSkips", {
              count: result.updated,
              field: target.label,
              skipped: result.skipped.length,
              names: result.skipped
                .slice(0, 3)
                .map((x) => x.name)
                .join(", "),
            }),
      );

      setSelected(new Set());
      setBulkEdit(null);
      router.refresh();
      restoreGridScroll(scroll);
    });
  };

  const [bulkDeleting, startBulkDelete] = useTransition();

  const confirmBulkDelete = () => {
    const ids = selectedRows.map((u) => u.id);
    if (ids.length === 0) return;
    const scroll = captureGridScroll();
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
      restoreGridScroll(scroll);
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

        {/* Bulk action bar. Present ONLY while something is selected, and it
            never leaves the filter's scope ambiguous — the count always reads
            "N of M filtered". */}
        {canSelect && selectedRows.length > 0 && (
          <BulkActionBar
            selectedCount={selectedRows.length}
            filteredCount={filtered.length}
            targets={bulkTargets}
            busy={bulkUpdating || bulkDeleting}
            canDelete={canDelete}
            canEdit={canEditStudents}
            onSelectAll={() => toggleAllFiltered(true)}
            onClear={() => setSelected(new Set())}
            onChange={setBulkEdit}
            onDelete={() => setBulkOpen(true)}
          />
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

      {bulkEdit && (
        <BulkEditModal
          target={bulkEdit}
          count={selectedRows.length}
          pending={bulkUpdating}
          courseOptions={courseOptions}
          classOptions={classOptions}
          onCancel={() => setBulkEdit(null)}
          onApply={(value) => applyBulkChange(bulkEdit, value)}
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
