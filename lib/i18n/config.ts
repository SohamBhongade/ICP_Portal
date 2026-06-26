// i18n configuration.
//
// WHY A PLAIN JSON + CONTEXT APPROACH (not next-intl):
// Next.js 16.2.9 is very new and next-intl may not yet support it cleanly. A
// hand-rolled "JSON dictionaries + React context" layer has ZERO compatibility
// risk, instant client-side switching, and is trivial to migrate to next-intl
// later if we want richer formatting/pluralization. The dictionary shape here
// is intentionally next-intl-friendly (nested namespaces, dot-path keys).

export const locales = ["en", "hi", "mr"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that stores the user's chosen UI language (non-sensitive). */
export const LOCALE_COOKIE = "icp_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
