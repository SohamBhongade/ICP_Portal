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
//      whitelisted column keys can ever be persisted.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { users } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import {
  sanitizeUsersTableLayout,
  type UiPreferences,
  type UsersTableLayout,
} from "@/lib/table-layout";

export type SavePreferencesResult = { ok: true } | { ok: false; error: "forbidden" };

/**
 * Persist the current user's Users-grid column layout (order + visibility).
 * Merges into any existing uiPreferences blob so unrelated preferences survive.
 */
export async function saveUsersTablePreferencesAction(
  layout: UsersTableLayout,
): Promise<SavePreferencesResult> {
  const user = await currentUserWithCapability("manageUsers");
  if (!user) return { ok: false, error: "forbidden" };

  const clean = sanitizeUsersTableLayout(layout);
  const existing = (user.uiPreferences ?? {}) as UiPreferences;
  const next: UiPreferences = { ...existing, usersTable: clean };

  await db
    .update(users)
    .set({ uiPreferences: next, updatedAt: new Date() })
    .where(eq(users.id, user.id));

  revalidatePath("/admin/users");
  return { ok: true };
}
