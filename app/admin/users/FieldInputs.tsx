"use client";

// Shared form controls for a user's editable fields.
//
// Extracted so the single-user Edit drawer and the bulk "Change X" modal use
// literally the same component rather than two lookalikes that drift. If a
// control accepts "2024-25" in one place it has to accept it in the other —
// otherwise an operator learns one rule and gets the other.
//
// The year control is an <input list> rather than a <select>: a plain dropdown
// is a picker but cannot take "2024-25", and a plain text box takes "2024-25"
// but is not a picker. `list` is both — the browser shows a real dropdown of
// years, and anything typed is still accepted and parsed by
// parseAdmissionYear / coerceFieldValue, which handle academic-year notation.

import { useId } from "react";
import { useT } from "@/components/i18n/LanguageProvider";
import { parseAdmissionYear } from "@/lib/academic-year";
import type { CustomField } from "@/lib/user-fields";

export const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal";

/** Years offered in the picker: a little ahead of today, back far enough for
 *  any leaving year a current record could hold. */
function pickableYears(): number[] {
  const thisYear = new Date().getFullYear();
  const years: number[] = [];
  for (let y = thisYear + 5; y >= thisYear - 40; y--) years.push(y);
  return years;
}

/**
 * Year entry with a dropdown of real years AND free text for academic years.
 *
 * `invalid` is derived by the caller (or here, when it doesn't care) using the
 * same parser the server uses, so the hint under the box can never claim a
 * value is fine that the action will then reject.
 */
export function YearInput({
  id,
  value,
  onChange,
  autoFocus,
}: {
  id?: string;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const t = useT();
  const listId = useId();
  const invalid = value.trim() !== "" && parseAdmissionYear(value) == null;

  return (
    <>
      <input
        id={id}
        list={listId}
        inputMode="numeric"
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("onboarding.create.admissionYearPlaceholder")}
        aria-invalid={invalid}
        className={inputClass}
      />
      <datalist id={listId}>
        {pickableYears().map((y) => (
          <option key={y} value={String(y)} />
        ))}
      </datalist>
      <p className={`mt-1 text-xs ${invalid ? "text-danger" : "text-muted"}`}>
        {invalid
          ? t("onboarding.create.admissionYearInvalid")
          : t("onboarding.create.admissionYearHint")}
      </p>
    </>
  );
}

/** True when this year text cannot be stored. Mirrors the server's parser. */
export function yearInputInvalid(value: string): boolean {
  return value.trim() !== "" && parseAdmissionYear(value) == null;
}

/**
 * The control one admin-defined column uses, chosen by its declared type.
 *
 * `year` renders the picker above rather than a date input — that is the whole
 * point of the type existing. A `year` column used to be a `date` column, which
 * forced a full YYYY-MM-DD into a cell that only ever holds a year, and was why
 * every "2024" in a spreadsheet had nowhere to go.
 */
export function CustomFieldInput({
  id,
  field,
  value,
  onChange,
  autoFocus,
}: {
  id?: string;
  field: CustomField;
  value: string;
  onChange: (next: string) => void;
  autoFocus?: boolean;
}) {
  const t = useT();

  if (field.type === "select") {
    return (
      <select
        id={id}
        autoFocus={autoFocus}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={inputClass}
      >
        <option value="">{t("onboarding.create.selectPlaceholder")}</option>
        {(field.options ?? []).map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (field.type === "year") {
    return (
      <YearInput id={id} value={value} onChange={onChange} autoFocus={autoFocus} />
    );
  }

  return (
    <input
      id={id}
      autoFocus={autoFocus}
      type={
        field.type === "date"
          ? "date"
          : field.type === "number"
            ? "number"
            : "text"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    />
  );
}
