"use server";

// Per-user UI preference mutations.
//
// This is the "API endpoint" for the dynamic column-customization feature. The
// codebase exposes no REST routes under /api — every mutation is a server action
// (see app/actions/*), so this follows that convention. The equivalent contract
// to a POST /api/user/preferences is `saveUsersTablePreferencesAction` below.
//
// Security guardrails (mirrors the rest of app/actions):
//   1. Re-verify the caller holds `manageUsers` on the SERVER — never trust the
//      client. The Users grid already requires this capability to be viewed.
//   2. Write ONLY to the caller's own row (id from the verified session, never
//      from the request payload) — a user can only change their own layout.
//   3. Run the untrusted payload through sanitizeUsersTableLayout so only
//      whitelisted column keys can ever be persisted. The whitelist is the
//      built-in set PLUS the custom columns that currently exist in
//      `user_fields`, loaded here on the server.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { logServerError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/core";
import { usersTableLayoutSchema } from "@/lib/validation/schemas";
import {
  sanitizeUsersTableLayout,
  type UiPreferences,
  type UsersTableLayout,
} from "@/lib/table-layout";
import { customColumnKey } from "@/lib/user-fields";
import { listUserFields } from "@/lib/user-fields-query";

export type SavePreferencesResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "validation" };

/**
 * Persist the current user's Users-grid column layout (order + visibility).
 * Merges into any existing uiPreferences blob so unrelated preferences survive.
 */
export async function saveUsersTablePreferencesAction(
  layout: UsersTableLayout,
): Promise<SavePreferencesResult> {
  const user = await currentUserWithCapability("manageUsers");
  if (!user) return { ok: false, error: "forbidden" };

  // Bound the array and the shape of each entry before it reaches the column
  // whitelist below. Two layers on purpose: this one caps size and types,
  // sanitizeUsersTableLayout decides which column keys actually exist.
  const parsed = parseInput(usersTableLayoutSchema, layout);
  if (!parsed.ok) return { ok: false, error: "validation" };

  // The live custom-column list is loaded from the DB, never taken from the
  // payload — it is what decides which `custom:*` keys are real. A forged key
  // is dropped here, and a column deleted since this page loaded is dropped too
  // rather than being persisted back into the layout.
  const fields = await listUserFields();
  const customKeys = fields.map((f) => customColumnKey(f.key));

  const clean = sanitizeUsersTableLayout(
    parsed.data as UsersTableLayout,
    customKeys,
  );
  const existing = (user.uiPreferences ?? {}) as UiPreferences;
  const next: UiPreferences = { ...existing, usersTable: clean };

  try {
    await db
      .update(users)
      .set({ uiPreferences: next, updatedAt: new Date() })
      .where(eq(users.id, user.id));
  } catch (err) {
    logServerError("saveUsersTablePreferencesAction", err, { userId: user.id });
    return { ok: false, error: "validation" };
  }

  revalidatePath("/admin/users");
  return { ok: true };
}
