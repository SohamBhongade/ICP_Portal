"use server";

// Edit Mode mutations (the Edit Mode toggle, dropdown options, and text
// overrides). EVERY action re-verifies the caller holds the `settings`
// capability on the server, at the TOP of the function, before any write —
// never trust the client for these.
//
// Per the enforcement matrix, `settings` is now ADMIN ONLY, so both
// "dropdown/settings edits" and "Edit Mode toggle" are admin-gated here.
// These throw rather than returning a typed result: the Edit Mode UI is only
// ever rendered for a capable role, so a denial here means a forged call.

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings, dropdownOptions, textOverrides } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { EDIT_MODE_KEY, type DropdownCategory } from "@/lib/edit-mode/settings";
import { logServerError } from "@/lib/errors";
import { parseInput } from "@/lib/validation/core";
import {
  addDropdownOptionSchema,
  idSchema,
  setEditModeSchema,
  textOverrideSchema,
} from "@/lib/validation/schemas";

/** Admin-only gate for every Edit Mode write. Throws; never returns null. */
async function assertSettings() {
  const user = await currentUserWithCapability("settings");
  if (!user) {
    // Log the denial server-side; the client gets a bare, structure-free string.
    logServerError("edit-mode", new Error("settings capability required"));
    throw new Error("You do not have permission to do that.");
  }
  return user;
}

/** Turn global Edit Mode on/off (stored in app_settings). */
export async function setEditModeAction(rawNext: boolean): Promise<void> {
  await assertSettings();
  const parsed = parseInput(setEditModeSchema, rawNext);
  // A non-boolean here can only be a forged call; refuse rather than coercing.
  if (!parsed.ok) throw new Error("Invalid request.");
  const next = parsed.data;

  await db
    .insert(appSettings)
    .values({ key: EDIT_MODE_KEY, value: String(next), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appSettings.key,
      set: { value: String(next), updatedAt: new Date() },
    });
  revalidatePath("/", "layout");
}

/**
 * Save (or clear) an admin override for a UI string in a given locale.
 * Empty value reverts to the JSON dictionary. No unique key on (locale,key),
 * so we delete-then-insert.
 */
export async function saveTextOverrideAction(
  rawLocale: string,
  rawKey: string,
  rawValue: string,
): Promise<void> {
  await assertSettings();

  // HIGHEST-RISK SURFACE. An override is authored by an admin and then rendered
  // to EVERY user of the app, so it is validated hardest:
  //   - locale: pinned to the supported enum.
  //   - key:    must look like a dictionary dot-path ("login.title"), so an
  //             override can only ever address a translation key.
  //   - value:  markup-free (see safeText in lib/validation/core) and capped.
  //
  // The primary XSS defence remains React's escaping of text children — every
  // override is rendered as {string}, and this codebase contains no
  // dangerouslySetInnerHTML at all. This check is defence in depth: the stored
  // data is inert even if a future change introduces an HTML sink.
  const parsed = parseInput(textOverrideSchema, {
    locale: rawLocale,
    key: rawKey,
    value: rawValue,
  });
  if (!parsed.ok) {
    // Static message only: no schema internals, no column names.
    throw new Error("That text could not be saved. Check the value and retry.");
  }
  const { locale, key, value } = parsed.data;

  await db
    .delete(textOverrides)
    .where(and(eq(textOverrides.locale, locale), eq(textOverrides.key, key)));

  // An empty value CLEARS the override and falls back to the JSON dictionary.
  if (value) {
    await db.insert(textOverrides).values({ locale, key, value });
  }
  revalidatePath("/", "layout");
}

/** Add a new dropdown option to a category. */
export async function addDropdownOptionAction(
  category: DropdownCategory,
  value: string,
  label: string,
): Promise<void> {
  await assertSettings();

  // Both the stored value and the displayed label are rendered back to every
  // user, so both go through the markup-rejecting text type.
  const parsed = parseInput(addDropdownOptionSchema, { category, value, label });
  if (!parsed.ok) {
    throw new Error("That option could not be saved. Check the name and retry.");
  }
  const v = parsed.data.value;
  const l = parsed.data.label || v;

  await db
    .insert(dropdownOptions)
    .values({ category: parsed.data.category, value: v, label: l, isActive: true });
  revalidatePath("/", "layout");
}

/** Soft-delete a dropdown option (deactivate, preserving history). */
export async function deleteDropdownOptionAction(rawId: number): Promise<void> {
  await assertSettings();
  const parsed = parseInput(idSchema, rawId);
  if (!parsed.ok) throw new Error("Invalid request.");

  await db
    .update(dropdownOptions)
    .set({ isActive: false })
    .where(eq(dropdownOptions.id, parsed.data));
  revalidatePath("/", "layout");
}
