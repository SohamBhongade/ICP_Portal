"use client";

// Bulk actions for the Users grid: the selection bar and the "Change <field>"
// modal behind it.
//
// Split out of UsersContent because that file is already the orchestrator for
// search, filters, two drawers, the import modal, the column manager and the
// toast queue. The bulk surface is self-contained — it takes a selection and
// emits an intent — so it lives here.
//
// WHO THIS IS FOR drives most of the choices below. The people running this
// console are university office staff, mostly not technical. Every affordance
// is therefore worded, large, and unambiguous, and the one irreversible action
// is kept physically apart from the reversible ones.

import { useState } from "react";
import { Loader2, Pencil, Trash2, TriangleAlert } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import {
  EditableDropdown,
  type DropdownOptionItem,
} from "@/components/edit-mode/EditableDropdown";
import type { BulkUpdateField } from "@/app/actions/onboarding";
import { parseAdmissionYear } from "@/lib/academic-year";
import { coerceFieldValue } from "@/lib/user-fields";
import { CustomFieldInput, YearInput, yearInputInvalid } from "./FieldInputs";
import { USERS_SCROLL_ID } from "./UsersTable";
import type { CustomField, UserRow } from "./types";

type Translator = ReturnType<typeof useT>;

/**
 * One thing the operator can change across a whole selection.
 *
 * Custom columns are ordinary members of this union rather than a special case,
 * so "Change Year of Leaving" needs no code of its own — it is simply the
 * column an admin created, and any column added later gets a button for free.
 */
export type BulkTarget =
  | { kind: "className"; label: string }
  | { kind: "course"; label: string }
  | { kind: "admissionYear"; label: string }
  | { kind: "custom"; field: CustomField; label: string };

// ---------------------------------------------------------------------------
// Scroll preservation
// ---------------------------------------------------------------------------

/** Grid scroll offset, carried across a refresh. */
export type ScrollPos = { top: number; left: number } | null;

export function captureGridScroll(): ScrollPos {
  const el = document.getElementById(USERS_SCROLL_ID);
  return el ? { top: el.scrollTop, left: el.scrollLeft } : null;
}

/**
 * Put the grid back where it was after a bulk action.
 *
 * Deleting rows shortens the content and the browser clamps scrollTop to the
 * new maximum — which silently throws an operator working at the bottom of a
 * 400-row roster back to the top. The rAF matters: the restore has to land
 * after the refreshed rows are laid out, not before.
 */
export function restoreGridScroll(pos: ScrollPos) {
  if (!pos) return;
  requestAnimationFrame(() => {
    const el = document.getElementById(USERS_SCROLL_ID);
    if (!el) return;
    el.scrollTop = pos.top;
    el.scrollLeft = pos.left;
  });
}

// ---------------------------------------------------------------------------
// Payload + optimistic patch
// ---------------------------------------------------------------------------

/** The server payload for one target plus the operator's raw input. */
export function bulkChangePayload(
  target: BulkTarget,
  value: string,
): BulkUpdateField {
  if (target.kind === "custom") {
    return { field: "custom", fieldId: target.field.id, value };
  }
  return { field: target.kind, value };
}

/**
 * The local patch to show while the write is in flight.
 *
 * Coerced with the SAME functions the server uses, so the optimistic cell and
 * the refreshed cell agree — an optimistic value that visibly changes a second
 * later is worse than no optimism at all. Course is the one approximation: the
 * server canonicalizes it through normalizeCourse, so the picked option value
 * stands in until the refresh lands.
 */
export function optimisticPatch(
  target: BulkTarget,
  value: string,
): Partial<UserRow> {
  const raw = value.trim();
  switch (target.kind) {
    case "className":
      return { className: raw || null };
    case "course":
      return { course: raw || null };
    case "admissionYear":
      return { admissionYear: raw ? parseAdmissionYear(raw) : null };
    case "custom": {
      const coerced = coerceFieldValue(target.field, raw);
      return {
        custom: { [target.field.key]: coerced.ok ? coerced.value : raw },
      };
    }
  }
}

/** Translate a bulk-update rejection into something an operator can act on. */
export function bulkUpdateErrorMessage(
  error: string,
  field: string,
  t: Translator,
): string {
  if (error === "rateLimited") return t("onboarding.errors.rateLimited");
  if (error === "forbidden") return t("onboarding.errors.forbidden");
  if (error === "invalidCourse") return t("onboarding.errors.invalidCourse");
  if (error === "invalidYear") return t("onboarding.create.admissionYearInvalid");
  if (error === "badValue") return t("onboarding.columns.errBadValue");
  return t("onboarding.bulk.changeFailed", { field });
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

/**
 * The bar above the grid, present only while rows are selected.
 *
 *   WORDS, NOT ICONS. Every button says what it does in full ("Change class",
 *   "Delete 12 users"); the icons sit beside the words rather than replacing
 *   them. An icon-only toolbar is a memory test.
 *
 *   BIG TARGETS. px-4 py-2.5 rather than the compact sizing used elsewhere in
 *   the console, because this is where the irreversible action lives.
 *
 *   THE DESTRUCTIVE BUTTON IS KEPT AWAY. Delete sits alone at the far end
 *   behind a divider, in red, never adjacent to a "Change X" button — so a
 *   mis-aimed click lands on nothing rather than on a delete.
 *
 *   ONE ACTION AT A TIME. While a batch is in flight every button is disabled
 *   and the bar says it is working, which makes double-firing structurally
 *   impossible rather than merely unlikely.
 */
export function BulkActionBar({
  selectedCount,
  filteredCount,
  targets,
  busy,
  canDelete,
  canEdit,
  onSelectAll,
  onClear,
  onChange,
  onDelete,
}: {
  selectedCount: number;
  filteredCount: number;
  targets: BulkTarget[];
  busy: boolean;
  canDelete: boolean;
  canEdit: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  onChange: (target: BulkTarget) => void;
  onDelete: () => void;
}) {
  const t = useT();

  return (
    <div
      role="region"
      aria-label={t("onboarding.bulk.barLabel")}
      aria-busy={busy}
      className="mb-3 rounded-lg border border-primary/30 bg-lavender px-4 py-3"
    >
      {/* Line 1 — what is selected, and how to undo that. The count always
          names the filter's scope, so "12 selected" is never ambiguous. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm font-semibold text-primary [font-variant-numeric:tabular-nums]">
          {t("onboarding.bulk.selectedCount", {
            count: selectedCount,
            total: filteredCount,
          })}
        </span>
        {selectedCount < filteredCount && (
          <button
            type="button"
            onClick={onSelectAll}
            disabled={busy}
            className="cursor-pointer text-sm font-medium text-teal underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("onboarding.bulk.selectAllFiltered", { count: filteredCount })}
          </button>
        )}
        <button
          type="button"
          onClick={onClear}
          disabled={busy}
          className="cursor-pointer text-sm font-medium text-muted underline-offset-2 hover:text-ink hover:underline disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("onboarding.bulk.clear")}
        </button>
        {busy && (
          <span
            role="status"
            className="flex items-center gap-1.5 text-sm font-medium text-primary"
          >
            <Loader2 className="size-4 animate-spin" aria-hidden />
            {t("onboarding.bulk.working")}
          </span>
        )}
      </div>

      {/* Line 2 — the actions. Changes on the left, delete isolated right. */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-primary/20 pt-3">
        {canEdit &&
          targets.map((target) => (
            <button
              key={
                target.kind === "custom"
                  ? `custom-${target.field.id}`
                  : target.kind
              }
              type="button"
              onClick={() => onChange(target)}
              disabled={busy}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:border-teal hover:bg-mint/40 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Pencil className="size-4" aria-hidden />
              {t("onboarding.bulk.changeField", { field: target.label })}
            </button>
          ))}

        {canDelete && (
          <div className="ml-auto flex items-center gap-3 border-l border-primary/20 pl-4">
            <span className="hidden text-xs text-muted lg:inline">
              {t("onboarding.bulk.scopeNote", { count: filteredCount })}
            </span>
            <button
              type="button"
              onClick={onDelete}
              disabled={busy}
              className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="size-4" aria-hidden />
              {t("onboarding.bulk.deleteSelected", { count: selectedCount })}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// "Change <field>"
// ---------------------------------------------------------------------------

/**
 * One small modal: one input, Cancel, Apply.
 *
 * The input is the SAME control the single-user Edit drawer uses for that field
 * — EditableDropdown for class and course, the year picker for a year, the
 * custom column's own control otherwise — imported from ./FieldInputs rather
 * than reimplemented, so the two cannot drift and teach different rules about
 * what is accepted.
 *
 * The modal stays open until the server answers, so the outcome is attached to
 * the thing the operator did rather than arriving as a toast over a dialog that
 * already closed.
 */
export function BulkEditModal({
  target,
  count,
  pending,
  courseOptions,
  classOptions,
  onCancel,
  onApply,
}: {
  target: BulkTarget;
  count: number;
  pending: boolean;
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  onCancel: () => void;
  onApply: (value: string) => void;
}) {
  const t = useT();
  const [value, setValue] = useState("");

  // Blocked only by a value this field genuinely cannot store. An EMPTY value
  // is allowed on purpose — "clear the year of leaving for these 40 students"
  // is a real registrar task — and the hint below says so.
  const invalid =
    target.kind === "admissionYear"
      ? yearInputInvalid(value)
      : target.kind === "custom"
        ? !coerceFieldValue(target.field, value).ok
        : false;

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
        <h2 className="text-base font-semibold text-ink">
          {t("onboarding.bulk.changeTitle", { field: target.label })}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {t("onboarding.bulk.changeBody", { count, field: target.label })}
        </p>

        <div className="mt-4">
          <label
            htmlFor="bulk-edit-value"
            className="mb-1 block text-sm font-medium text-ink"
          >
            {t("onboarding.bulk.newValue", { field: target.label })}
          </label>

          {target.kind === "className" ? (
            <EditableDropdown
              category="class"
              options={classOptions}
              value={value}
              onChange={setValue}
              placeholder={t("onboarding.create.selectPlaceholder")}
            />
          ) : target.kind === "course" ? (
            <EditableDropdown
              category="course"
              options={courseOptions}
              value={value}
              onChange={setValue}
              placeholder={t("onboarding.create.selectPlaceholder")}
            />
          ) : target.kind === "admissionYear" ? (
            <YearInput
              id="bulk-edit-value"
              value={value}
              onChange={setValue}
              autoFocus
            />
          ) : (
            <CustomFieldInput
              id="bulk-edit-value"
              field={target.field}
              value={value}
              onChange={setValue}
              autoFocus
            />
          )}

          <p className="mt-2 text-xs text-muted">
            {t("onboarding.bulk.clearHint", { field: target.label })}
          </p>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="cursor-pointer rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={() => onApply(value)}
            disabled={pending || invalid}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {pending
              ? t("onboarding.bulk.applying")
              : t("onboarding.bulk.apply", { count })}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bulk delete confirmation
// ---------------------------------------------------------------------------

/**
 * The most destructive action in the console. It cascades across tickets,
 * ledgers, attendance and custom column values for every selected account, and
 * there is no undo. So it does three things a plain "Are you sure?" does not:
 *
 *   1. States the EXACT count in the heading AND on the button itself, so the
 *      number is in front of the operator at the moment they commit.
 *   2. Lists the accounts, scrollable, so they see WHO they selected rather
 *      than a number.
 *   3. Pushes the red button away from Cancel and says plainly that this is
 *      permanent, naming what else goes with each account.
 *
 * NO TYPE-TO-CONFIRM. The previous version made the operator type the count
 * before the button enabled. That is a reasonable pattern in a developer tool
 * and a poor one here: this console is run by university office staff, and a
 * text box between someone and a task they deliberately set up is friction that
 * gets worked around or abandoned, not safety. The count on the button, the
 * visible name list, and the fact that nothing here is reachable without first
 * ticking rows by hand carry the weight instead.
 *
 * NO UNDO EITHER — deliberately, because it would be a lie. bulkDeleteUsersAction
 * performs a hard cascade delete, not a soft delete: there is no archived row
 * to restore and no flag to flip back. An "Undo" on an unrecoverable delete is
 * worse than none. If this should become recoverable, the change belongs in the
 * action (a `deleted_at` column and a restore path), not in a toast.
 */
export function BulkDeleteConfirm({
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

        {/* Who, not how many. Scrollable so a 100-account sweep still shows
            every name rather than truncating to "and 97 others". */}
        <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted">
          {t("onboarding.bulk.listLabel", { count: users.length })}
        </p>
        <ul className="mt-1 max-h-48 overflow-y-auto rounded-md border border-line bg-canvas px-3 py-2 text-sm">
          {users.map((u) => (
            <li key={u.id} className="truncate py-0.5 text-ink">
              {u.fullName}
              {u.studentId && <span className="text-muted"> — {u.studentId}</span>}
            </li>
          ))}
        </ul>

        {/* Cancel and Delete are separated by the full width of the footer, so
            the destructive button is never where a reflexive click lands. */}
        <div className="mt-5 flex items-center justify-between gap-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="cursor-pointer rounded-md border border-line bg-surface px-4 py-2.5 text-sm font-semibold text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending}
            className="inline-flex cursor-pointer items-center gap-2 rounded-md bg-danger px-4 py-2.5 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Trash2 className="size-4" aria-hidden />
            )}
            {pending
              ? t("onboarding.deleting")
              : t("onboarding.bulk.deleteSelected", { count: users.length })}
          </button>
        </div>
      </div>
    </div>
  );
}
