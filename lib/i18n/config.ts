// i18n configuration.
//
// The portal is ENGLISH-ONLY. The translation layer (JSON dictionary + React
// context + useT) is intentionally kept so UI strings stay centralized and Edit
// Mode text overrides keep working — but there is now a single locale, so the
// language switcher UI has been removed. Re-adding a language is as simple as
// appending its code here and dropping a messages/<code>.json dictionary in.

export const locales = ["en"] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

/** Cookie that stores the user's chosen UI language (non-sensitive). */
export const LOCALE_COOKIE = "icp_locale";

export function isLocale(value: string | undefined | null): value is Locale {
  return !!value && (locales as readonly string[]).includes(value);
}
