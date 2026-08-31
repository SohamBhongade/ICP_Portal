"use client";

// Admin > Users — the column panel.
//
// Two jobs in one dialog, deliberately kept distinct:
//
//   LAYOUT (Phase 7)  — order + visibility of the columns YOU see. Edits a
//                       draft and commits on Save; personal, stored on your own
//                       user row.
//   DEFINITIONS (Phase 9) — create / rename / delete admin-defined columns.
//                       Global, immediate (each is its own server action), and
//                       gated on `settings` rather than manageUsers.
//
// The split matters because the consequences differ by an order of magnitude:
// hiding a column changes your view, deleting one destroys every value stored
// in it for every user. So layout edits are batched behind Save, and a delete
// gets its own typed confirmation.
//
// Core columns (Name, Roll No., Role, Status) render a lock and no delete
// button. That is a HINT, not the enforcement — they have no `user_fields` row,
// so deleteUserFieldAction has nothing to point at even if this UI is bypassed.

import { useState, useTransition } from "react";
import {
  ArrowDown,
  ArrowUp,
  Lock,
  Pencil,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import {
  DEFAULT_USERS_TABLE_LAYOUT,
  PROTECTED_COLUMN_KEYS,
  USERS_COLUMN_LABEL_KEY,
  fieldKeyFromColumn,
  isBuiltInColumn,
  type ColumnKey,
  type UsersColumnKey,
  type UsersTableLayout,
} from "@/lib/table-layout";
import {
  USER_FIELD_LIMITS,
  USER_FIELD_TYPES,
  type UserFieldType,
} from "@/lib/user-fields";
import {
  createUserFieldAction,
  deleteUserFieldAction,
  renameUserFieldAction,
  type UserFieldError,
} from "@/app/actions/user-fields";
import type { CustomField, ToastKind } from "./types";

const PROTECTED = new Set<string>(PROTECTED_COLUMN_KEYS);

export function ColumnManager({
  layout,
  customFields,
  canManageColumns,
  saving,
  onCancel,
  onSave,
  notify,
  onFieldsChanged,
}: {
  layout: UsersTableLayout;
  customFields: CustomField[];
  /** `settings` holders only. Non-admins still get the layout half. */
  canManageColumns: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (next: UsersTableLayout) => void;
  notify: (kind: ToastKind, message: string) => void;
  /** Ask the page to re-fetch after a definition change. */
  onFieldsChanged: () => void;
}) {
  const t = useT();
  const [draft, setDraft] = useState<UsersTableLayout>(layout);
  const [adding, setAdding] = useState(false);
  const [renameTarget, setRenameTarget] = useState<CustomField | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomField | null>(null);

  const fieldByKey = new Map(customFields.map((f) => [f.key, f]));

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

  /** The custom field behind a layout row, or undefined for a built-in. */
  const customFor = (key: ColumnKey): CustomField | undefined => {
    if (isBuiltInColumn(key)) return undefined;
    const fieldKey = fieldKeyFromColumn(key);
    return fieldKey ? fieldByKey.get(fieldKey) : undefined;
  };

  const labelFor = (key: ColumnKey): string =>
    isBuiltInColumn(key)
      ? t(USERS_COLUMN_LABEL_KEY[key as UsersColumnKey])
      : (customFor(key)?.label ?? key);

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
        className="relative flex max-h-[85vh] w-full max-w-lg flex-col rounded-lg border border-line bg-surface shadow-xl"
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
          {draft.map((col, i) => {
            const field = customFor(col.key);
            const locked = PROTECTED.has(col.key);
            return (
              <li
                key={col.key}
                className="flex items-center gap-2 rounded-md px-2 py-2 hover:bg-canvas"
              >
                <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={col.visible}
                    onChange={() => toggle(i)}
                    className="size-4 shrink-0 accent-primary"
                  />
                  <span className="min-w-0">
                    <span
                      className={`block truncate text-sm font-medium ${col.visible ? "text-ink" : "text-muted"}`}
                      title={labelFor(col.key)}
                    >
                      {labelFor(col.key)}
                    </span>
                    {field && (
                      <span className="block truncate text-xs text-muted">
                        {t("onboarding.columns.customBadge", {
                          type: t(`onboarding.columns.type.${field.type}`),
                        })}
                      </span>
                    )}
                  </span>
                  {locked && (
                    <Lock
                      className="size-3.5 shrink-0 text-muted"
                      aria-label={t("onboarding.columns.protected")}
                    />
                  )}
                </label>

                <div className="flex shrink-0 items-center gap-1">
                  {/* Rename + delete only ever appear on a custom column. */}
                  {field && canManageColumns && (
                    <>
                      <button
                        type="button"
                        onClick={() => setRenameTarget(field)}
                        aria-label={`${t("onboarding.columns.rename")}: ${field.label}`}
                        title={t("onboarding.columns.rename")}
                        className="rounded border border-line p-1 text-muted hover:bg-lavender hover:text-ink"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteTarget(field)}
                        aria-label={`${t("onboarding.columns.deleteColumn")}: ${field.label}`}
                        title={t("onboarding.columns.deleteColumn")}
                        className="rounded border border-line p-1 text-danger hover:border-danger/40 hover:bg-danger/10"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </>
                  )}
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
            );
          })}
        </ul>

        {canManageColumns && (
          <div className="border-t border-line px-4 py-3">
            {adding ? (
              <NewColumnForm
                onCancel={() => setAdding(false)}
                onDone={() => {
                  setAdding(false);
                  onFieldsChanged();
                }}
                notify={notify}
              />
            ) : (
              <button
                type="button"
                onClick={() => setAdding(true)}
                disabled={customFields.length >= USER_FIELD_LIMITS.maxFields}
                title={
                  customFields.length >= USER_FIELD_LIMITS.maxFields
                    ? t("onboarding.columns.limitReached", {
                        max: USER_FIELD_LIMITS.maxFields,
                      })
                    : undefined
                }
                className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-lavender disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="size-3.5" /> {t("onboarding.columns.addColumn")}
              </button>
            )}
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line p-4">
          <button
            type="button"
            onClick={() => setDraft(DEFAULT_USERS_TABLE_LAYOUT)}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            <RotateCcw className="size-3.5" /> {t("onboarding.columns.restore")}
          </button>
          <button
            type="button"
            onClick={() => onSave(draft)}
            disabled={saving || visibleCount === 0}
            title={visibleCount === 0 ? t("onboarding.columns.needOne") : undefined}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? t("onboarding.columns.saving") : t("onboarding.columns.save")}
          </button>
        </div>
      </div>

      {renameTarget && (
        <RenameColumnDialog
          field={renameTarget}
          onClose={() => setRenameTarget(null)}
          onDone={() => {
            setRenameTarget(null);
            onFieldsChanged();
          }}
          notify={notify}
        />
      )}

      {deleteTarget && (
        <DeleteColumnDialog
          field={deleteTarget}
          onClose={() => setDeleteTarget(null)}
          onDone={() => {
            setDeleteTarget(null);
            onFieldsChanged();
          }}
          notify={notify}
        />
      )}
    </div>
  );
}

/** Inline "add a column" form. The KEY is derived server-side from the label. */
function NewColumnForm({
  onCancel,
  onDone,
  notify,
}: {
  onCancel: () => void;
  onDone: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const t = useT();
  const [label, setLabel] = useState("");
  const [type, setType] = useState<UserFieldType>("text");
  const [optionsText, setOptionsText] = useState("");
  const [pending, start] = useTransition();

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    const options =
      type === "select"
        ? optionsText
            .split(/[\n,]/)
            .map((o) => o.trim())
            .filter(Boolean)
        : undefined;
    if (type === "select" && (!options || options.length === 0)) {
      notify("error", t("onboarding.columns.needOptions"));
      return;
    }

    start(async () => {
      const res = await createUserFieldAction({ label: trimmed, type, options });
      if (!res.ok) {
        notify("error", fieldErrorMessage(res.error, t));
        return;
      }
      notify("success", t("onboarding.columns.created", { label: res.field.label }));
      onDone();
    });
  };

  return (
    <div className="flex flex-col gap-3 rounded-md border border-line bg-canvas p-3">
      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink">
          {t("onboarding.columns.newLabel")}
        </span>
        <input
          autoFocus
          value={label}
          maxLength={USER_FIELD_LIMITS.maxLabel}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t("onboarding.columns.newLabelPlaceholder")}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-medium text-ink">
          {t("onboarding.columns.newType")}
        </span>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as UserFieldType)}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
        >
          {USER_FIELD_TYPES.map((v) => (
            <option key={v} value={v}>
              {t(`onboarding.columns.type.${v}`)}
            </option>
          ))}
        </select>
      </label>

      {type === "select" && (
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-ink">
            {t("onboarding.columns.newOptions")}
          </span>
          <textarea
            rows={3}
            value={optionsText}
            onChange={(e) => setOptionsText(e.target.value)}
            placeholder={t("onboarding.columns.newOptionsPlaceholder")}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
          />
        </label>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="cursor-pointer rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-lavender"
        >
          {t("common.cancel")}
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={pending || !label.trim()}
          className="cursor-pointer rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t("onboarding.columns.saving") : t("onboarding.columns.addColumn")}
        </button>
      </div>
    </div>
  );
}

function RenameColumnDialog({
  field,
  onClose,
  onDone,
  notify,
}: {
  field: CustomField;
  onClose: () => void;
  onDone: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const t = useT();
  const [label, setLabel] = useState(field.label);
  const [pending, start] = useTransition();

  const submit = () => {
    const trimmed = label.trim();
    if (!trimmed) return;
    start(async () => {
      const res = await renameUserFieldAction({ id: field.id, label: trimmed });
      if (!res.ok) {
        notify("error", fieldErrorMessage(res.error, t));
        return;
      }
      notify("success", t("onboarding.columns.renamed", { label: trimmed }));
      onDone();
    });
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-sm rounded-lg border border-line bg-surface p-5 shadow-xl"
      >
        <h2 className="text-base font-semibold text-ink">
          {t("onboarding.columns.rename")}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {t("onboarding.columns.renameHint")}
        </p>
        <input
          autoFocus
          value={label}
          maxLength={USER_FIELD_LIMITS.maxLabel}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          className="mt-4 w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
        />
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !label.trim()}
            className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending ? t("onboarding.columns.saving") : t("onboarding.columns.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Destructive confirmation for dropping a column.
 *
 * Deleting a column destroys every value stored in it, for every user, with no
 * undo — so this asks the operator to type the column's name. A second button
 * click is muscle memory; retyping the label is not.
 */
function DeleteColumnDialog({
  field,
  onClose,
  onDone,
  notify,
}: {
  field: CustomField;
  onClose: () => void;
  onDone: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const t = useT();
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const confirmed = typed.trim().toLowerCase() === field.label.trim().toLowerCase();

  const submit = () => {
    if (!confirmed) return;
    start(async () => {
      const res = await deleteUserFieldAction(field.id);
      if (!res.ok) {
        notify("error", fieldErrorMessage(res.error, t));
        return;
      }
      notify(
        "success",
        t("onboarding.columns.deleted", {
          label: res.label,
          count: res.valuesDeleted,
        }),
      );
      onDone();
    });
  };

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/40"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-lg border border-line bg-surface p-6 shadow-xl"
      >
        <div className="flex items-start gap-3">
          <span className="rounded-full bg-danger/10 p-2 text-danger">
            <TriangleAlert className="size-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-ink">
              {t("onboarding.columns.deleteTitle", { label: field.label })}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {t("onboarding.columns.deleteBody", { label: field.label })}
            </p>
          </div>
        </div>

        <label className="mt-4 block">
          <span className="mb-1 block text-xs font-medium text-ink">
            {t("onboarding.columns.deleteConfirmLabel", { label: field.label })}
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
          />
        </label>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="cursor-pointer rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={pending || !confirmed}
            className="cursor-pointer rounded-md bg-danger px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {pending
              ? t("onboarding.deleting")
              : t("onboarding.columns.deleteConfirm")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Stable server error code -> message. */
function fieldErrorMessage(
  error: UserFieldError,
  t: ReturnType<typeof useT>,
): string {
  switch (error) {
    case "forbidden":
      return t("onboarding.errors.forbidden");
    case "rateLimited":
      return t("onboarding.errors.rateLimited");
    case "notFound":
      return t("onboarding.errors.notFound");
    case "duplicate":
      return t("onboarding.columns.errDuplicate");
    case "limitReached":
      return t("onboarding.columns.limitReached", {
        max: USER_FIELD_LIMITS.maxFields,
      });
    case "badLabel":
      return t("onboarding.columns.errBadLabel");
    case "badValue":
      return t("onboarding.columns.errBadValue");
    default:
      return t("onboarding.errors.unknown");
  }
}
