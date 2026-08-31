// Server-side READS for the dynamic user columns.
//
// These deliberately do NOT live in app/actions/user-fields.ts. Every export of
// a "use server" module is published as a callable endpoint with its own action
// id, so putting an unauthenticated read helper there would expose it to any
// client that guesses the id — and `loadUserFieldValues` takes a caller-supplied
// list of user ids, which would make it an arbitrary-read primitive over every
// user's custom data.
//
// "server-only" makes that a build error rather than a review finding: importing
// this module from a client component fails the build outright.
//
// Callers are server components and server actions that have ALREADY verified a
// capability. These functions are the query layer, not the gate.

import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { userFieldValues, userFields } from "@/db/schema";
import type { CustomField, UserFieldType } from "@/lib/user-fields";

/** Every active custom column, in display order. */
export async function listUserFields(): Promise<CustomField[]> {
  const rows = await db
    .select({
      id: userFields.id,
      key: userFields.key,
      label: userFields.label,
      type: userFields.type,
      options: userFields.options,
      sortOrder: userFields.sortOrder,
    })
    .from(userFields)
    .where(eq(userFields.isActive, true))
    .orderBy(userFields.sortOrder, userFields.id);

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    type: row.type as UserFieldType,
    options: row.options ?? null,
    sortOrder: row.sortOrder,
  }));
}

/**
 * Every custom value for a set of users, grouped by user id and keyed by FIELD
 * key (not by the `custom:` layout key).
 *
 * One query for the whole page rather than one per row — at 20 columns and a
 * few hundred users that is a few thousand narrow rows, which is far cheaper
 * than the round trips would be.
 */
export async function loadUserFieldValues(
  userIds: number[],
): Promise<Map<number, Record<string, string>>> {
  const grouped = new Map<number, Record<string, string>>();
  if (userIds.length === 0) return grouped;

  const rows = await db
    .select({
      userId: userFieldValues.userId,
      key: userFields.key,
      value: userFieldValues.value,
    })
    .from(userFieldValues)
    .innerJoin(userFields, eq(userFieldValues.fieldId, userFields.id))
    .where(
      and(
        inArray(userFieldValues.userId, userIds),
        eq(userFields.isActive, true),
      ),
    );

  for (const row of rows) {
    if (row.value == null) continue;
    const bucket = grouped.get(row.userId) ?? {};
    bucket[row.key] = row.value;
    grouped.set(row.userId, bucket);
  }
  return grouped;
}
