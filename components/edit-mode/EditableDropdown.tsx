"use client";

// <EditableDropdown> is a normal <select> sourced from dropdown_options. For
// admins with Edit Mode on, it gains "add option" / "delete option" controls
// that write to dropdown_options. Reusable as a form field in later phases
// (attendance, onboarding) — supports both uncontrolled (name + defaultValue)
// and controlled (value + onChange) usage.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { useEditMode } from "./EditModeProvider";
import {
  addDropdownOptionAction,
  deleteDropdownOptionAction,
} from "@/app/actions/edit-mode";
import type { DropdownCategory } from "@/lib/edit-mode/settings";

export type DropdownOptionItem = { id: number; value: string; label: string };

// Derive a stable machine value from the human-friendly name the admin types,
// so non-technical staff never see the underlying DB value.
// e.g. "B.Pharm" → "b_pharm", "First Year" → "first_year", "Batch C" → "batch_c".
const toValue = (label: string) =>
  label
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");

export function EditableDropdown({
  category,
  options,
  name,
  id,
  value,
  defaultValue,
  onChange,
  required,
  placeholder,
  className,
}: {
  category: DropdownCategory;
  options: DropdownOptionItem[];
  name?: string;
  id?: string;
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  required?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const t = useT();
  const { editing } = useEditMode();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [newName, setNewName] = useState("");

  const selectProps =
    value !== undefined
      ? { value, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) }
      : { defaultValue, onChange: (e: React.ChangeEvent<HTMLSelectElement>) => onChange?.(e.target.value) };

  const add = () => {
    const label = newName.trim();
    const value = toValue(label);
    // Guard: label must be non-empty and yield at least one usable value char.
    if (!label || !value) return;
    startTransition(async () => {
      await addDropdownOptionAction(category, value, label);
      setNewName("");
      router.refresh();
    });
  };

  const remove = (optId: number) => {
    startTransition(async () => {
      await deleteDropdownOptionAction(optId);
      router.refresh();
    });
  };

  return (
    <div>
      <select
        name={name}
        id={id}
        required={required}
        {...selectProps}
        className={
          className ??
          "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
        }
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.id} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {editing && (
        <div className="mt-2 rounded-md border border-dashed border-teal/50 bg-mint/30 p-2">
          <ul className="mb-2 space-y-1">
            {options.map((o) => (
              <li
                key={o.id}
                className="flex items-center justify-between rounded bg-surface px-2 py-1 text-sm text-ink"
              >
                <span>{o.label}</span>
                <button
                  type="button"
                  onClick={() => remove(o.id)}
                  disabled={pending}
                  aria-label={`${t("common.delete")} ${o.label}`}
                  className="rounded p-1 text-danger hover:bg-lavender disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  add();
                }
              }}
              placeholder={t(`editMode.namePlaceholder.${category}`)}
              className="min-w-0 flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-teal"
            />
            <button
              type="button"
              onClick={add}
              disabled={pending}
              className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-teal px-3 py-1 text-sm font-medium text-teal-foreground hover:bg-teal-light disabled:opacity-50"
            >
              <Plus className="size-4" /> {t("editMode.addOption")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
