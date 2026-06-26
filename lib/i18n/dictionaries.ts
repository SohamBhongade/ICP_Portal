// Static dictionary imports + the core lookup logic shared by client and server.
//
// Dictionaries are imported statically so all three languages ship in the client
// bundle — that's what makes language switching INSTANT (no fetch on switch).
// They're small JSON files, so the bundle cost is negligible.

import en from "@/messages/en.json";
import hi from "@/messages/hi.json";
import mr from "@/messages/mr.json";
import { defaultLocale, type Locale } from "./config";

/** A nested dictionary: leaves are strings, branches are sub-dictionaries. */
export type Dict = { [key: string]: string | Dict };

export const dictionaries: Record<Locale, Dict> = {
  en: en as unknown as Dict,
  hi: hi as unknown as Dict,
  mr: mr as unknown as Dict,
};

/** Flat per-locale overrides sourced from the DB (Edit Mode). Keys are dot-paths. */
export type OverrideMap = Partial<Record<Locale, Record<string, string>>>;

/** Resolve a dot-path (e.g. "login.title") in a nested dictionary. */
function resolvePath(dict: Dict, key: string): string | undefined {
  const value = key.split(".").reduce<string | Dict | undefined>((acc, part) => {
    if (acc && typeof acc === "object") return acc[part];
    return undefined;
  }, dict);
  return typeof value === "string" ? value : undefined;
}

/** Replace {placeholders} with provided values. */
function interpolate(
  template: string,
  vars?: Record<string, string | number>,
): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, name: string) =>
    name in vars ? String(vars[name]) : `{${name}}`,
  );
}

/**
 * Translate a key for a locale.
 * Lookup order: DB override (locale) → locale JSON → default-locale JSON → key.
 * This overlay order is what lets admin Edit Mode text edits take effect.
 */
export function translate(
  locale: Locale,
  key: string,
  overrides: OverrideMap,
  vars?: Record<string, string | number>,
): string {
  const override = overrides[locale]?.[key];
  const resolved =
    override ??
    resolvePath(dictionaries[locale], key) ??
    resolvePath(dictionaries[defaultLocale], key) ??
    key;
  return interpolate(resolved, vars);
}
