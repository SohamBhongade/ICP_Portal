"use client";

// Placeholder for dashboard sections that later phases will build out.

import { Construction } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";

export function ComingSoon({ titleKey }: { titleKey: string }) {
  const t = useT();
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 rounded-lg border border-line bg-surface p-10 text-center shadow-sm">
      <Construction className="size-8 text-primary" aria-hidden />
      <h2 className="text-lg font-semibold text-ink">{t(titleKey)}</h2>
      <p className="text-sm text-muted">{t("common.comingSoon")}</p>
    </div>
  );
}
