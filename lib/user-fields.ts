// Dynamic user columns (Phase 9) — shared, dependency-free helpers.
//
// Client-safe on purpose (no "server-only", no db import), because the same
// rules are needed in four places and must not drift:
//   1. app/actions/user-fields.ts — creating / renaming / deleting a column
//   2. app/actions/import.ts      — validating a mapping's custom targets
//   3. app/admin/users/*          — rendering the grid and the column manager
//   4. lib/table-layout.ts        — encoding a custom column into a saved layout
//
// The single most important rule in this file: a column's KEY is derived from
// its label once, at creation, and is then immutable. Saved column layouts and
// saved import mappings reference the key, so renaming must only ever touch the
// label. `slugifyFieldKey` is therefore a create-time function, never a
// rename-time one.

import {
  MAX_YEAR,
  MIN_YEAR,
  normalizeDateCell,
  normalizeYearCell,
  type DateIssue,
} from "./import/dates";

/**
 * Value types a custom column can declare.
 *
 * `year` was added alongside the import date fix. A column like "Year of
 * Leaving" is conceptually a YEAR, not a timestamp: a spreadsheet cell reading
 * "2024" or "2024-25" had nowhere valid to go on a `date` column, which demands
 * a full YYYY-MM-DD, so every such value was being dropped. A `year` column
 * stores the bare integer as text ("2024") and accepts academic-year notation.
 *
 * SQLite stores this enum as plain text and user_field_values.value is TEXT for
 * every type, so widening the union needs no DDL — only db/migrate-user-field-
 * year-type.ts, which flips the two existing year columns over.
 */
export const USER_FIELD_TYPES = [
  "text",
  "number",
  "date",
  "year",
  "select",
] as const;
export type UserFieldType = (typeof USER_FIELD_TYPES)[number];

/** Field types whose raw spreadsheet cell needs date/year normalization. */
export function isDateLikeType(type: UserFieldType): boolean {
  return type === "date" || type === "year";
}

export const USER_FIELD_LIMITS = {
  /** Custom columns per installation. Bounds the grid width, the per-page join,
   *  and the size of a saved layout blob. */
  maxFields: 20,
  /** Characters in a display label. */
  maxLabel: 40,
  /** Characters in a generated key (after slugification). */
  maxKey: 40,
  /** Choices allowed on a `select` column. */
  maxOptions: 40,
  /** Characters in one choice. */
  maxOptionLength: 60,
  /** Characters in a stored value. Matches the import cell cap. */
  maxValue: 500,
} as const;

/** Prefix that namespaces a custom column inside a saved column layout. */
export const CUSTOM_COLUMN_PREFIX = "custom:";

/** Encode a field key as the column key used by the grid layout. */
export function customColumnKey(fieldKey: string): string {
  return `${CUSTOM_COLUMN_PREFIX}${fieldKey}`;
}

/** Decode a layout column key back to a field key, or null if it isn't one. */
export function fieldKeyFromColumn(columnKey: string): string | null {
  return columnKey.startsWith(CUSTOM_COLUMN_PREFIX)
    ? columnKey.slice(CUSTOM_COLUMN_PREFIX.length)
    : null;
}

export function isCustomColumn(columnKey: string): boolean {
  return columnKey.startsWith(CUSTOM_COLUMN_PREFIX);
}

/**
 * Derive a stable machine key from a human label.
 *
 * Deliberately narrow output — `[a-z0-9_]` only — because this string ends up
 * inside a layout key, an import mapping key, and a DOM id. Returns "" when the
 * label has no usable characters at all (e.g. it was pure punctuation), which
 * the caller must treat as a validation failure rather than storing.
 */
export function slugifyFieldKey(label: string): string {
  return label
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, USER_FIELD_LIMITS.maxKey)
    .replace(/_+$/, "");
}

/**
 * Pick a key that collides with nothing.
 *
 * `taken` must include BOTH the existing custom keys and the built-in column
 * keys — a custom column called "Name" would otherwise shadow the core one in
 * every layout lookup. Suffixes rather than rejecting, so an admin adding a
 * second "Notes" column gets `notes_2` instead of an error they can't act on.
 */
export function uniqueFieldKey(label: string, taken: Iterable<string>): string {
  const base = slugifyFieldKey(label);
  if (!base) return "";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `_${n}`;
    const candidate =
      base.slice(0, USER_FIELD_LIMITS.maxKey - suffix.length) + suffix;
    if (!used.has(candidate)) return candidate;
  }
  return "";
}

/** A custom column as the client needs it. Mirrors the DB row, minus audit columns. */
export type CustomField = {
  id: number;
  key: string;
  label: string;
  type: UserFieldType;
  options: string[] | null;
  sortOrder: number;
};

/**
 * Validate one value against its column's declared type.
 *
 * Returns a stable error code (the UI translates it) or null when the value is
 * acceptable. An empty value is always acceptable — custom columns have no
 * required flag, so "not filled in yet" is a normal state for every row.
 */
export type FieldValueIssue =
  | "tooLong"
  | "notNumber"
  | "notDate"
  | "notYear"
  | "notAnOption";

export function validateFieldValue(
  field: Pick<CustomField, "type" | "options">,
  raw: string,
): FieldValueIssue | null {
  const value = raw.trim();
  if (!value) return null;
  if (value.length > USER_FIELD_LIMITS.maxValue) return "tooLong";

  switch (field.type) {
    case "number":
      return Number.isFinite(Number(value)) ? null : "notNumber";
    case "date":
      // Strict YYYY-MM-DD, and the date must actually exist. This is the
      // STORAGE contract, not the input contract — anything a human or a
      // spreadsheet typed goes through coerceFieldValue first.
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "notDate";
      {
        const [y, m, d] = value.split("-").map(Number);
        const dt = new Date(Date.UTC(y, m - 1, d));
        const real =
          dt.getUTCFullYear() === y &&
          dt.getUTCMonth() === m - 1 &&
          dt.getUTCDate() === d;
        return real ? null : "notDate";
      }
    case "year": {
      // Stored as the bare 4-digit year, nothing else.
      if (!/^\d{4}$/.test(value)) return "notYear";
      const n = Number(value);
      return n >= MIN_YEAR && n <= MAX_YEAR ? null : "notYear";
    }
    case "select":
      return field.options?.includes(value) ? null : "notAnOption";
    case "text":
      return null;
  }
}

/**
 * Turn whatever a human or a spreadsheet supplied into the value we will STORE,
 * or say precisely why we can't.
 *
 * This is the function every write path must use. `validateFieldValue` alone
 * was the bug: it is a storage-shape check, so an Excel serial ("45231") or a
 * typed "03/04/2005" failed it, and the import's response to a failure was to
 * skip the cell in silence. Coercion first, and a REPORTED issue when coercion
 * fails, is what closes that hole.
 *
 * Returns `{ ok: true, value: "" }` for a blank cell — absent and blank mean the
 * same thing for a custom column, and callers delete rather than store "".
 */
export type CoerceResult =
  | { ok: true; value: string }
  | { ok: false; issue: FieldValueIssue; detail?: DateIssue };

export function coerceFieldValue(
  field: Pick<CustomField, "type" | "options">,
  raw: unknown,
): CoerceResult {
  const value = typeof raw === "string" ? raw.trim() : raw;
  if (value == null || value === "") return { ok: true, value: "" };

  if (field.type === "date") {
    const out = normalizeDateCell(value);
    if (!out.ok) return { ok: false, issue: "notDate", detail: out.issue };
    return { ok: true, value: out.value ?? "" };
  }

  if (field.type === "year") {
    const out = normalizeYearCell(value);
    if (!out.ok) return { ok: false, issue: "notYear", detail: out.issue };
    return { ok: true, value: out.value == null ? "" : String(out.value) };
  }

  // Everything else stores the trimmed text verbatim; validate as before.
  const text = String(value).trim();
  const issue = validateFieldValue(field, text);
  return issue ? { ok: false, issue } : { ok: true, value: text };
}
