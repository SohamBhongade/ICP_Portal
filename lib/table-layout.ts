// Dynamic column layout for the Admin > Users data grid.
//
// This module is deliberately dependency-free and client-safe (no "server-only",
// no db import) so it can be shared by three call sites:
//   1. db/schema.ts        — the JSON column's TS type (`UiPreferences`)
//   2. app/actions/*        — server-side sanitize before persisting
//   3. app/admin/users/*    — client-side rendering + the customization panel
//
// The column key set is a whitelist. `sanitizeUsersTableLayout` is the single
// trust boundary: it accepts arbitrary/untrusted input (a stale saved blob or a
// forged action payload) and always returns a valid layout that contains every
// known column exactly once — unknown keys dropped, duplicates collapsed, and
// any newly-added columns appended (visible) so the schema can evolve safely.

/** Customizable columns, in their default display order. Every column here —
 *  including `name` — can be reordered or hidden from the "Customize columns"
 *  panel. Only the row-actions column is structural (always rendered last). */
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

/** i18n key for each column's header label (reused by the config panel). */
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
export type UsersColumnPref = { key: UsersColumnKey; visible: boolean };

/** Ordered layout for the users grid — order of the array IS the column order. */
export type UsersTableLayout = UsersColumnPref[];

/** Shape of the users.uiPreferences JSON blob. Namespaced per table so other
 *  grids can persist their own layouts here later without colliding. */
export type UiPreferences = {
  usersTable?: UsersTableLayout;
};

/** Everything visible, default order. */
export const DEFAULT_USERS_TABLE_LAYOUT: UsersTableLayout =
  USERS_COLUMN_KEYS.map((key) => ({ key, visible: true }));

/**
 * Coerce any input into a valid, complete layout. This is the trust boundary
 * for both reads (a persisted blob may predate a column change) and writes (the
 * action must never store an attacker-controlled key). Guarantees: every known
 * column appears exactly once and unknown keys are dropped.
 *
 * A missing column (e.g. `name` for an admin whose saved layout predates it) is
 * inserted at its correct position RELATIVE to the default order — right after
 * the nearest already-placed column that precedes it in DEFAULT (or at the front
 * when it has none) — rather than dumped at the end. So a previously-default
 * layout reconstructs exactly, and `name` lands first instead of jumping to the
 * far right on the admin's next login.
 */
export function sanitizeUsersTableLayout(input: unknown): UsersTableLayout {
  const canonicalIndex = new Map<UsersColumnKey, number>(
    USERS_COLUMN_KEYS.map((key, i) => [key, i]),
  );
  const seen = new Set<UsersColumnKey>();
  const result: UsersTableLayout = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const key = (item as { key?: unknown }).key;
      if (typeof key !== "string" || !canonicalIndex.has(key as UsersColumnKey)) {
        continue;
      }
      const k = key as UsersColumnKey;
      if (seen.has(k)) continue; // collapse duplicates
      seen.add(k);
      // Anything other than an explicit `false` counts as visible.
      result.push({ key: k, visible: (item as { visible?: unknown }).visible !== false });
    }
  }

  // Splice in any column the saved layout didn't mention at its default-relative
  // slot. Iterating in canonical order keeps consecutive inserts in sequence.
  for (const key of USERS_COLUMN_KEYS) {
    if (seen.has(key)) continue;
    seen.add(key);
    const idx = canonicalIndex.get(key)!;
    // Insert just after the last already-placed column that precedes this one in
    // the default order; 0 (front) when there is no such predecessor.
    let insertAt = 0;
    for (let i = 0; i < result.length; i++) {
      if (canonicalIndex.get(result[i].key)! < idx) insertAt = i + 1;
    }
    result.splice(insertAt, 0, { key, visible: true });
  }

  return result;
}
