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

/** Customizable columns, in their default display order. `fullName` (the
 *  identity anchor) and the row-actions column are structural and NOT part of
 *  this set — they are always rendered first / last respectively. */
export const USERS_COLUMN_KEYS = [
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
 * column appears exactly once, unknown keys are dropped, and missing columns are
 * appended as visible so the result is always safe to render.
 */
export function sanitizeUsersTableLayout(input: unknown): UsersTableLayout {
  const known = new Set<string>(USERS_COLUMN_KEYS);
  const seen = new Set<UsersColumnKey>();
  const result: UsersTableLayout = [];

  if (Array.isArray(input)) {
    for (const item of input) {
      if (!item || typeof item !== "object") continue;
      const key = (item as { key?: unknown }).key;
      if (typeof key !== "string" || !known.has(key)) continue;
      const k = key as UsersColumnKey;
      if (seen.has(k)) continue; // collapse duplicates
      seen.add(k);
      // Anything other than an explicit `false` counts as visible.
      result.push({ key: k, visible: (item as { visible?: unknown }).visible !== false });
    }
  }

  // Append any known column the saved layout didn't mention (schema evolved).
  for (const key of USERS_COLUMN_KEYS) {
    if (!seen.has(key)) result.push({ key, visible: true });
  }

  return result;
}
