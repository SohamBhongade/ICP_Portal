// Server-only helpers for the Edit Mode backbone: app_settings flags and
// dropdown_options reads. Writes live in app/actions/edit-mode.ts.

import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { appSettings, dropdownOptions } from "@/db/schema";

export const EDIT_MODE_KEY = "edit_mode";

export type DropdownCategory =
  | "course"
  | "semester"
  | "subject"
  | "class"
  | "practical_batch";

/** Read a single app setting value (or null). */
export async function getAppSetting(key: string): Promise<string | null> {
  const [row] = await db
    .select({ value: appSettings.value })
    .from(appSettings)
    .where(eq(appSettings.key, key))
    .limit(1);
  return row?.value ?? null;
}

/** Whether global Edit Mode is currently on. */
export async function getEditMode(): Promise<boolean> {
  return (await getAppSetting(EDIT_MODE_KEY)) === "true";
}

/** Active options for a dropdown category, ordered by sortOrder then label. */
export async function getDropdownOptions(category: DropdownCategory) {
  return db
    .select()
    .from(dropdownOptions)
    .where(
      and(
        eq(dropdownOptions.category, category),
        eq(dropdownOptions.isActive, true),
      ),
    )
    .orderBy(asc(dropdownOptions.sortOrder), asc(dropdownOptions.label));
}
