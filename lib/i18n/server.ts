// Server-only i18n helpers: read the locale cookie and load DB text overrides.

import "server-only";
import { cookies } from "next/headers";
import { db } from "@/db";
import { textOverrides } from "@/db/schema";
import { LOCALE_COOKIE, defaultLocale, isLocale, type Locale } from "./config";
import { translate, type OverrideMap } from "./dictionaries";

/** Resolve the active locale from the cookie (falls back to default). */
export async function getServerLocale(): Promise<Locale> {
  const store = await cookies();
  const value = store.get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : defaultLocale;
}

/**
 * Load all admin text overrides, grouped by locale, as { locale: { key: value } }.
 * Wrapped in try/catch so a DB hiccup never breaks rendering — the UI just falls
 * back to the JSON dictionaries.
 */
export async function getTextOverrides(): Promise<OverrideMap> {
  try {
    const rows = await db
      .select({
        locale: textOverrides.locale,
        key: textOverrides.key,
        value: textOverrides.value,
      })
      .from(textOverrides);

    const map: OverrideMap = {};
    for (const row of rows) {
      (map[row.locale as Locale] ??= {})[row.key] = row.value;
    }
    return map;
  } catch (err) {
    console.error("Failed to load text overrides; using JSON fallback.", err);
    return {};
  }
}

/**
 * Server-component equivalent of the client `useT()` hook: resolves the locale
 * and DB overrides once, then returns a synchronous translate function with the
 * same (key, vars) signature.
 */
export async function getT(): Promise<
  (key: string, vars?: Record<string, string | number>) => string
> {
  const [locale, overrides] = await Promise.all([
    getServerLocale(),
    getTextOverrides(),
  ]);
  return (key, vars) => translate(locale, key, overrides, vars);
}
