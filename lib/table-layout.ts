// Column layout for the Admin > Users data grid.
//
// This module is deliberately dependency-free and client-safe (no "server-only",
// no db import) so it can be shared by four call sites:
//   1. db/schema.ts        — the JSON column's TS type (`UiPreferences`)
//   2. app/actions/*        — server-side sanitize before persisting
//   3. app/admin/users/*    — client-side rendering + the customization panel
//   4. lib/user-fields.ts   — the custom-column key codec (imported here)
//
// TWO KINDS OF COLUMN (Phase 9):
//   - BUILT-IN, from the closed `USERS_COLUMN_KEYS` union below. Backed by a
//     real `users` table column.
//   - CUSTOM, an admin-defined column stored in `user_fields`, addressed in a
//     layout as `custom:<field key>`.
//
// `sanitizeUsersTableLayout` is the single trust boundary for both. It accepts
// arbitrary/untrusted input (a stale saved blob, a forged action payload) and
// always returns a valid layout containing every currently-known column exactly
// once — unknown keys dropped, duplicates collapsed, new columns appended
// visible. Because a deleted custom column is simply no longer in the known set,
// it falls out of every admin's saved layout with no cleanup migration.

import {
  CUSTOM_COLUMN_PREFIX,
  fieldKeyFromColumn,
  isCustomColumn,
} from "./user-fields";

/** Built-in customizable columns, in their default display order. Every column
 *  here — including `name` — can be reordered or hidden from the "Customize
 *  columns" panel. Only the selection and row-actions columns are structural. */
export const USERS_COLUMN_KEYS = [
  "name",
  "rollNo",
  "email",
  "phone",
  "role",
  "course",
  "className",
  "status",
  "joinedDate",
] as const;

export type UsersColumnKey = (typeof USERS_COLUMN_KEYS)[number];

/** Any column addressable in a layout: a built-in key or `custom:<field key>`. */
export type ColumnKey = UsersColumnKey | (string & {});

const BUILT_IN = new Set<string>(USERS_COLUMN_KEYS);

export function isBuiltInColumn(key: string): key is UsersColumnKey {
  return BUILT_IN.has(key);
}

/**
 * Core columns an admin may never DELETE (they can still be hidden).
 *
 * This list drives the lock badge in the column manager. It is not the
 * enforcement mechanism — that is structural: core columns have no `user_fields`
 * row, and the delete action can only address a `user_fields.id`, so there is no
 * reachable code path that removes one no matter what a forged payload says.
 */
export const PROTECTED_COLUMN_KEYS: readonly UsersColumnKey[] = [
  "name",
  "rollNo",
  "role",
  "status",
];

/** i18n key for each built-in column's header label. */
export const USERS_COLUMN_LABEL_KEY: Record<UsersColumnKey, string> = {
  name: "onboarding.colName",
  rollNo: "onboarding.colRollNo",
  email: "onboarding.colEmail",
  phone: "onboarding.colPhone",
  role: "onboarding.colRole",
  course: "onboarding.colCourse",
  className: "onboarding.colClass",
  status: "onboarding.colStatus",
  joinedDate: "onboarding.colJoined",
};

/** One column's saved preference: its key plus whether it's shown. */
export type UsersColumnPref = { key: ColumnKey; visible: boolean };

/** Ordered layout for the users grid — order of the array IS the column order. */
export type UsersTableLayout = UsersColumnPref[];

/** Shape of the users.uiPreferences JSON blob. Namespaced per table so other
 *  grids can persist their own layouts here later without colliding. */
export type UiPreferences = {
  usersTable?: UsersTableLayout;
};

/** Every built-in column visible, default order. Custom columns are appended by
 *  `sanitizeUsersTableLayout` from the live field list. */
export const DEFAULT_USERS_TABLE_LAYOUT: UsersTableLayout =
  USERS_COLUMN_KEYS.map((key) => ({ key, visible: true }));

/**
 * Coerce any input into a valid, complete layout.
 *
 * `customKeys` is the set of `custom:<field key>` columns that CURRENTLY exist,
 * loaded from the database by the caller. It is what makes a forged custom key
 * impossible to persist and a deleted column self-cleaning.
 *
 * Guarantees: every known column appears exactly once; unknown keys are dropped.
 *
 * A missing column (e.g. `name` for an admin whose saved layout predates it, or
 * a custom column added yesterday) is inserted at its correct position RELATIVE
 * to the canonical order — right after the nearest already-placed column that
 * precedes it — rather than dumped at the end. So a previously-default layout
 * reconstructs exactly, and `name` lands first instead of jumping to the far
 * right on the admin's next login. Custom columns sort after every built-in.
 */
export function sanitizeUsersTableLayout(
  input: unknown,
  customKeys: readonly string[] = [],
): UsersTableLayout {
  // Canonical order = built-ins first, then custom columns in the order the
  // caller supplied (which is user_fields.sort_order).
  const canonical: ColumnKey[] = [
    ...USERS_COLUMN_KEYS,
    ...customKeys.filter((k) => isCustomColumn(k)),
  ];
  const canonicalIndex = new Map<ColumnKey, number>(
    canonical.map((key, i) => [key, i]),
  );
  const seen = new Set<ColumnKey>();
  const result: UsersTableLayout = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const key = (item as { key?: unknown }).key;
      if (typeof key !== "string" || !canonicalIndex.has(key)) continue;
      if (seen.has(key)) continue; // collapse duplicates
      seen.add(key);
      // Anything other than an explicit `false` counts as visible.
      result.push({ key, visible: (item as { visible?: unknown }).visible !== false });
    }
  }

  // Splice in any column the saved layout didn't mention at its canonical-
  // relative slot. Iterating in canonical order keeps consecutive inserts in
  // sequence.
  for (const key of canonical) {
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = canonicalIndex.get(key)!;
    // Insert just after the last already-placed column that precedes this one in
    // the canonical order; 0 (front) when there is no such predecessor.
    let insertAt = 0;
    for (let i = 0; i < result.length; i++) {
      if (canonicalIndex.get(result[i].key)! < idx) insertAt = i + 1;
    }
    result.splice(insertAt, 0, { key, visible: true });
  }

  return result;
}

// ---------------------------------------------------------------------------
// Phase 8 — frozen-column geometry for the Users data grid.
//
// The sticky table uses `table-layout: fixed` with an explicit <colgroup>, so
// every column needs a known pixel width. That is not cosmetic: a frozen column
// is positioned with `left: <sum of the widths before it>`, so the offsets are
// only correct if the widths are authoritative rather than measured.
// ---------------------------------------------------------------------------

/** Structural (non-customizable) columns that bracket the customizable set. */
export type UsersStructuralKey = "select" | "actions";

/** Fixed px width for every built-in / structural column. */
const BUILT_IN_WIDTH: Record<UsersColumnKey | UsersStructuralKey, number> = {
  select: 48,
  rollNo: 132,
  name: 208,
  email: 240,
  phone: 148,
  role: 132,
  course: 148,
  className: 132,
  status: 128,
  joinedDate: 148,
  actions: 108,
};

/** Width used by every admin-defined column. One value, so the frozen offsets
 *  stay computable without measuring a header an admin can rename at will. */
export const CUSTOM_COLUMN_WIDTH = 168;

/** Authoritative render width for any column key. */
export function columnWidth(key: string): number {
  return (
    BUILT_IN_WIDTH[key as UsersColumnKey | UsersStructuralKey] ??
    CUSTOM_COLUMN_WIDTH
  );
}

/** Back-compat alias for the built-in width table (Phase 8 call sites). */
export const USERS_COLUMN_WIDTH = BUILT_IN_WIDTH;

/** Built-in columns that are frozen to the LEFT edge when visible.
 *  These are the row's identity — they must stay readable while the middle
 *  columns scroll underneath. Everything else, custom columns included,
 *  scrolls. */
export const USERS_PINNED_LEFT: readonly UsersColumnKey[] = ["rollNo", "name"];

/**
 * Split the visible column order into the left-frozen group and the scrolling
 * middle group, preserving the user's saved ordering *within* each group.
 *
 * A pinned column the admin has hidden simply drops out and the frozen rail
 * narrows — hiding still works. What a pinned column cannot do is move into the
 * middle group, since being frozen is what the pin means. Custom columns are
 * never pinned.
 */
export function splitPinnedColumns(visible: ColumnKey[]): {
  left: UsersColumnKey[];
  middle: ColumnKey[];
} {
  const left: UsersColumnKey[] = [];
  const middle: ColumnKey[] = [];
  for (const key of visible) {
    if (isBuiltInColumn(key) && USERS_PINNED_LEFT.includes(key)) left.push(key);
    else middle.push(key);
  }
  return { left, middle };
}

/**
 * Running `left:` offset for each entry of the frozen-left rail, in order.
 * `offsets[i]` is the sum of every width before index `i`.
 */
export function stickyLeftOffsets(keys: string[]): number[] {
  let running = 0;
  return keys.map((key) => {
    const offset = running;
    running += columnWidth(key);
    return offset;
  });
}

// Re-exported so grid code needs only this module for column identity.
export { CUSTOM_COLUMN_PREFIX, fieldKeyFromColumn, isCustomColumn };
