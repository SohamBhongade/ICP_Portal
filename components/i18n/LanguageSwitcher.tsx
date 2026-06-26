"use client";

// Language switcher. Shows each language in its NATIVE name (English / हिंदी /
// मराठी) regardless of the current locale, so users always recognize their own.
//
// Two variants:
//   "buttons" (default) — segmented control, good for the prominent login screen
//   "compact"           — a labeled <select>, good for headers/sidebars

import { Languages } from "lucide-react";
import { useLocale, useT } from "./LanguageProvider";
import type { Locale } from "@/lib/i18n/config";

export function LanguageSwitcher({
  variant = "buttons",
}: {
  variant?: "buttons" | "compact";
}) {
  const { locale, setLocale, locales } = useLocale();
  const t = useT();

  if (variant === "compact") {
    return (
      <label className="inline-flex items-center gap-2 text-sm text-ink">
        <Languages className="size-4 text-muted" aria-hidden />
        <span className="sr-only">{t("language.label")}</span>
        <select
          value={locale}
          onChange={(e) => setLocale(e.target.value as Locale)}
          className="cursor-pointer rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-teal"
        >
          {locales.map((l) => (
            <option key={l} value={l}>
              {t(`language.${l}`)}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div
      role="group"
      aria-label={t("language.label")}
      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface p-1"
    >
      {locales.map((l) => {
        const active = l === locale;
        return (
          <button
            key={l}
            type="button"
            onClick={() => setLocale(l)}
            aria-pressed={active}
            className={`cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground"
                : "text-ink hover:bg-lavender"
            }`}
          >
            {t(`language.${l}`)}
          </button>
        );
      })}
    </div>
  );
}
