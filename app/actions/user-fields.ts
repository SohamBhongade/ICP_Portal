"use server";

// Phase 9 — dynamic user columns.
//
// Create / rename / delete admin-defined columns on the Users grid, plus the
// per-cell value write. Every entry point re-verifies its capability on the
// SERVER; the column manager is hidden from non-admins, but that is
// presentation only.
//
// READS live in lib/user-fields-query.ts, not here. Every export of a
// "use server" module becomes a callable endpoint, so an unauthenticated read
// helper in this file would be a public one — and one of them takes a
// caller-supplied list of user ids.
//
// GATE: `settings` — the same capability that guards dropdown options and text
// overrides. That is deliberately STRICTER than `manageUsers`: adding or
// dropping a column changes the shape of the console for every admin and
// destroys stored data, which is a configuration change, not a user edit. An
// Office Admin may edit a user; they may not redefine what a user IS.
//
// THREE INVARIANTS THIS FILE ENFORCES:
//
//   1. A column's KEY is derived here, from the label, at creation only. It is
//      never accepted from the caller and never rewritten by a rename, because
//      saved column layouts (users.ui_preferences) and saved import mappings
//      reference it.
//
//   2. Core columns (Name, Roll No., Role, Status, Actions) cannot be deleted.
//      This is structural, not a blocklist: they have no `user_fields` row, and
//      deleteUserFieldAction can only address a `user_fields.id`. A forged
//      payload has nothing to point at. Creation additionally refuses any key
//      that collides with a built-in, so no custom column can shadow one.
//
//   3. Deleting a column destroys its stored values. That is irreversible, so
//      the values and the definition go out as ONE db.batch() — an implicit
//      transaction on libSQL — and can never half-apply.

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userFieldValues, userFields, users } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { logServerError } from "@/lib/errors";
import { RULES, checkRateLimit } from "@/lib/rate-limit";
import { USERS_COLUMN_KEYS } from "@/lib/table-layout";
import {
  USER_FIELD_LIMITS,
  uniqueFieldKey,
  validateFieldValue,
  type CustomField,
  type UserFieldType,
} from "@/lib/user-fields";
import { parseInput } from "@/lib/validation/core";
import {
  createUserFieldSchema,
  idSchema,
  renameUserFieldSchema,
  setUserFieldValueSchema,
} from "@/lib/validation/schemas";

export type UserFieldError =
  | "forbidden"
  | "validation"
  | "rateLimited"
  | "notFound"
  | "duplicate"
  | "limitReached"
  | "badLabel"
  | "badValue"
  | "unknown";

export type UserFieldResult =
  | { ok: true; field: CustomField }
  | { ok: false; error: UserFieldError; retryAfter?: number };

export type DeleteUserFieldResult =
  | { ok: true; label: string; valuesDeleted: number }
  | { ok: false; error: UserFieldError; retryAfter?: number };

export type SetFieldValueResult =
  | { ok: true }
  | { ok: false; error: UserFieldError };

/**
 * Column definitions are configuration, not user data — `settings`, which is
 * admin-only. See the file header for why this is stricter than `manageUsers`.
 */
async function assertFieldAdmin() {
  return currentUserWithCapability("settings");
}

function revalidateGrid() {
  revalidatePath("/admin/users");
  revalidatePath("/admin/settings");
}

/** Shape a DB row for the client. */
function toCustomField(row: {
  id: number;
  key: string;
  label: string;
  type: string;
  options: string[] | null;
  sortOrder: number;
}): CustomField {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as UserFieldType,
    options: row.options ?? null,
    sortOrder: row.sortOrder,
  };
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createUserFieldAction(input: {
  label: string;
  type: UserFieldType;
  options?: string[];
}): Promise<UserFieldResult> {
  const admin = await assertFieldAdmin();
  if (!admin) return { ok: false, error: "forbidden" };

  const parsed = parseInput(createUserFieldSchema, input);
  if (!parsed.ok) return { ok: false, error: "validation" };
  const data = parsed.data;

  const limit = await checkRateLimit(RULES.userFieldMutation, String(admin.id));
  if (!limit.allowed) {
    return { ok: false, error: "rateLimited", retryAfter: limit.retryAfter };
  }

  // A select column with no choices would render an unfillable cell.
  const options =
    data.type === "select"
      ? Array.from(new Set((data.options ?? []).filter(Boolean)))
      : null;
  if (data.type === "select" && (!options || options.length === 0)) {
    return { ok: false, error: "validation" };
  }

  const existing = await db
    .select({ key: userFields.key })
    .from(userFields)
    .orderBy(userFields.sortOrder, userFields.id);

  if (existing.length >= USER_FIELD_LIMITS.maxFields) {
    return { ok: false, error: "limitReached" };
  }

  // KEY DERIVATION — server-side, once, from the label. `taken` includes the
  // built-in column keys so a custom "Name" can never shadow the core one.
  const taken = [...existing.map((f) => f.key), ...USERS_COLUMN_KEYS];
  const key = uniqueFieldKey(data.label, taken);
  // Empty means the label had no alphanumeric characters at all (e.g. "***").
  if (!key) return { ok: false, error: "badLabel" };

  try {
    const [row] = await db
      .insert(userFields)
      .values({
        key,
        label: data.label,
        type: data.type,
        options,
        // Append: new columns land to the right of every existing one.
        sortOrder: existing.length,
        createdBy: admin.id,
      })
      .onConflictDoNothing()
      .returning({
        id: userFields.id,
        key: userFields.key,
        label: userFields.label,
        type: userFields.type,
        options: userFields.options,
        sortOrder: userFields.sortOrder,
      });

    // No row back => the UNIQUE key raced another admin creating the same one.
    if (!row) return { ok: false, error: "duplicate" };

    revalidateGrid();
    return { ok: true, field: toCustomField(row) };
  } catch (err) {
    logServerError("createUserFieldAction", err, { key });
    return { ok: false, error: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Rename
// ---------------------------------------------------------------------------

/**
 * Rename a column. Touches `label` ONLY.
 *
 * The key is deliberately left alone: every saved layout and every saved import
 * mapping references it, so re-deriving it here would orphan them all and make
 * an admin's columns silently reshuffle after a cosmetic edit.
 */
export async function renameUserFieldAction(input: {
  id: number;
  label: string;
}): Promise<UserFieldResult> {
  const admin = await assertFieldAdmin();
  if (!admin) return { ok: false, error: "forbidden" };

  const parsed = parseInput(renameUserFieldSchema, input);
  if (!parsed.ok) return { ok: false, error: "validation" };
  const data = parsed.data;

  const limit = await checkRateLimit(RULES.userFieldMutation, String(admin.id));
  if (!limit.allowed) {
    return { ok: false, error: "rateLimited", retryAfter: limit.retryAfter };
  }

  try {
    const [row] = await db
      .update(userFields)
      .set({ label: data.label, updatedAt: new Date() })
      .where(and(eq(userFields.id, data.id), eq(userFields.isActive, true)))
      .returning({
        id: userFields.id,
        key: userFields.key,
        label: userFields.label,
        type: userFields.type,
        options: userFields.options,
        sortOrder: userFields.sortOrder,
      });

    if (!row) return { ok: false, error: "notFound" };

    revalidateGrid();
    return { ok: true, field: toCustomField(row) };
  } catch (err) {
    logServerError("renameUserFieldAction", err, { id: data.id });
    return { ok: false, error: "unknown" };
  }
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete a column AND every value stored in it. Irreversible.
 *
 * Core columns are unreachable from here by construction — they have no
 * `user_fields` row for an id to resolve to (invariant 2 in the file header).
 *
 * The value sweep and the definition delete go out as one db.batch(), which
 * libSQL runs in an implicit transaction, so the pair can never half-apply and
 * leave orphaned values pointing at a field that no longer exists.
 *
 * The count of destroyed values is read BEFORE the delete and returned, so the
 * confirmation the operator already accepted can be echoed back as fact.
 */
export async function deleteUserFieldAction(
  rawId: number,
): Promise<DeleteUserFieldResult> {
  const admin = await assertFieldAdmin();
  if (!admin) return { ok: false, error: "forbidden" };

  const parsed = parseInput(idSchema, rawId);
  if (!parsed.ok) return { ok: false, error: "validation" };
  const id = parsed.data;

  const limit = await checkRateLimit(RULES.userFieldMutation, String(admin.id));
  if (!limit.allowed) {
    return { ok: false, error: "rateLimited", retryAfter: limit.retryAfter };
  }

  const [field] = await db
    .select({ id: userFields.id, label: userFields.label })
    .from(userFields)
    .where(eq(userFields.id, id))
    .limit(1);
  if (!field) return { ok: false, error: "notFound" };

  const [counted] = await db
    .select({ n: sql<number>`count(*)` })
    .from(userFieldValues)
    .where(eq(userFieldValues.fieldId, id));

  try {
    await db.batch([
      db.delete(userFieldValues).where(eq(userFieldValues.fieldId, id)),
      db.delete(userFields).where(eq(userFields.id, id)),
    ]);
  } catch (err) {
    logServerError("deleteUserFieldAction", err, { id });
    return { ok: false, error: "unknown" };
  }

  // Saved layouts are NOT rewritten here. sanitizeUsersTableLayout drops any key
  // that is no longer in the live field list, so every admin's stored layout
  // self-heals on their next page load — no cleanup pass over `users`.
  revalidateGrid();
  return { ok: true, label: field.label, valuesDeleted: Number(counted?.n ?? 0) };
}

// ---------------------------------------------------------------------------
// Write one cell
// ---------------------------------------------------------------------------

/**
 * Set (or clear) one user's value for one custom column.
 *
 * `manageUsers` rather than `settings`: this is editing a user, not redefining
 * a column. The field's TYPE is loaded from the DB and validated against —
 * never taken from the payload — so a `select` column can only ever store one
 * of its declared options.
 *
 * An empty value DELETES the row rather than storing "": absent and blank mean
 * the same thing to every reader, and not storing blanks keeps the table
 * proportional to real data rather than to users x fields.
 */
export async function setUserFieldValueAction(input: {
  userId: number;
  fieldId: number;
  value: string;
}): Promise<SetFieldValueResult> {
  const admin = await currentUserWithCapability("manageUsers");
  if (!admin) return { ok: false, error: "forbidden" };

  const parsed = parseInput(setUserFieldValueSchema, input);
  if (!parsed.ok) return { ok: false, error: "validation" };
  const data = parsed.data;

  const [field] = await db
    .select({
      id: userFields.id,
      type: userFields.type,
      options: userFields.options,
    })
    .from(userFields)
    .where(and(eq(userFields.id, data.fieldId), eq(userFields.isActive, true)))
    .limit(1);
  if (!field) return { ok: false, error: "notFound" };

  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.id, data.userId))
    .limit(1);
  if (!target) return { ok: false, error: "notFound" };

  const value = data.value.trim();

  if (!value) {
    await db
      .delete(userFieldValues)
      .where(
        and(
          eq(userFieldValues.userId, data.userId),
          eq(userFieldValues.fieldId, data.fieldId),
        ),
      );
    revalidateGrid();
    return { ok: true };
  }

  const issue = validateFieldValue(
    { type: field.type as UserFieldType, options: field.options ?? null },
    value,
  );
  if (issue) return { ok: false, error: "badValue" };

  try {
    await db
      .insert(userFieldValues)
      .values({ userId: data.userId, fieldId: data.fieldId, value })
      // UNIQUE(user_id, field_id) is what makes this an upsert.
      .onConflictDoUpdate({
        target: [userFieldValues.userId, userFieldValues.fieldId],
        set: { value, updatedAt: new Date() },
      });
  } catch (err) {
    logServerError("setUserFieldValueAction", err, {
      userId: data.userId,
      fieldId: data.fieldId,
    });
    return { ok: false, error: "unknown" };
  }

  revalidateGrid();
  return { ok: true };
}
