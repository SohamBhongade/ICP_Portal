"use client";

// Client i18n context. Holds the active locale + DB overrides (passed from the
// server layout) and exposes:
//   useT()      -> t(key, vars?) translator
//   useLocale() -> { locale, setLocale, locales }
//
// Switching locale updates ALL text instantly (dictionaries are bundled) and
// persists the choice to a cookie + localStorage. After login (Phase 5) the
// choice is also written to users.preferredLanguage.

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import {
  LOCALE_COOKIE,
  defaultLocale,
  isLocale,
  locales,
  type Locale,
} from "@/lib/i18n/config";
import { translate, type OverrideMap } from "@/lib/i18n/dictionaries";

type Translator = (
  key: string,
  vars?: Record<string, string | number>,
) => string;

type LanguageContextValue = {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  locales: readonly Locale[];
  t: Translator;
};

const LanguageContext = createContext<LanguageContextValue | null>(null);

function persistLocale(locale: Locale) {
  // Non-httpOnly cookie so the server can read it on the next request for SSR.
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
  try {
    localStorage.setItem(LOCALE_COOKIE, locale);
  } catch {
    // localStorage may be unavailable (private mode) — cookie is enough.
  }
}

export function LanguageProvider({
  initialLocale,
  overrides,
  children,
}: {
  initialLocale: Locale;
  overrides: OverrideMap;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(
    isLocale(initialLocale) ? initialLocale : defaultLocale,
  );

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
    // Keep <html lang> in sync for a11y / screen readers.
    document.documentElement.lang = next;
  }, []);

  const t = useCallback<Translator>(
    (key, vars) => translate(locale, key, overrides, vars),
    [locale, overrides],
  );

  const value = useMemo<LanguageContextValue>(
    () => ({ locale, setLocale, locales, t }),
    [locale, setLocale, t],
  );

  return (
    <LanguageContext.Provider value={value}>
      {children}
    </LanguageContext.Provider>
  );
}

function useLanguageContext(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error("useT/useLocale must be used within <LanguageProvider>");
  }
  return ctx;
}

/** Returns the translator function `t(key, vars?)`. */
export function useT(): Translator {
  return useLanguageContext().t;
}

/** Returns the current locale and a setter + the list of available locales. */
export function useLocale() {
  const { locale, setLocale, locales } = useLanguageContext();
  return { locale, setLocale, locales };
}
