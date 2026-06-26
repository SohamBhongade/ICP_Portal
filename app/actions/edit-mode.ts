"use server";

// Edit Mode mutations. EVERY action re-verifies the caller is an admin on the
// server — never trust the client for these writes (guardrail).

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { appSettings, dropdownOptions, textOverrides } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import { EDIT_MODE_KEY, type DropdownCategory } from "@/lib/edit-mode/settings";
import { isLocale } from "@/lib/i18n/config";

async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") {
    throw new Error("Forbidden: admin only.");
  }
  return user;
}

/** Turn global Edit Mode on/off (stored in app_settings). */
export async function setEditModeAction(next: boolean): Promise<void> {
  await assertAdmin();
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
  locale: string,
  key: string,
  value: string,
): Promise<void> {
  await assertAdmin();
  if (!isLocale(locale) || !key) throw new Error("Invalid override target.");

  await db
    .delete(textOverrides)
    .where(and(eq(textOverrides.locale, locale), eq(textOverrides.key, key)));

  const trimmed = value.trim();
  if (trimmed) {
    await db.insert(textOverrides).values({ locale, key, value: trimmed });
  }
  revalidatePath("/", "layout");
}

/** Add a new dropdown option to a category. */
export async function addDropdownOptionAction(
  category: DropdownCategory,
  value: string,
  label: string,
): Promise<void> {
  await assertAdmin();
  const v = value.trim();
  const l = label.trim() || v;
  if (!v) throw new Error("Option value is required.");

  await db
    .insert(dropdownOptions)
    .values({ category, value: v, label: l, isActive: true });
  revalidatePath("/", "layout");
}

/** Soft-delete a dropdown option (deactivate, preserving history). */
export async function deleteDropdownOptionAction(id: number): Promise<void> {
  await assertAdmin();
  await db
    .update(dropdownOptions)
    .set({ isActive: false })
    .where(eq(dropdownOptions.id, id));
  revalidatePath("/", "layout");
}
