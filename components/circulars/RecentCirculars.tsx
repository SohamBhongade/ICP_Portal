"use client";

// Compact "recent circulars" feed for role dashboards. Read-only: title, date,
// and a quick view link. Falls back to a translated empty state.

import { FileText, ImageIcon } from "lucide-react";
import { useT, useLocale } from "@/components/i18n/LanguageProvider";
import type { CircularItem } from "./CircularsBoard";

export function RecentCirculars({ items }: { items: CircularItem[] }) {
  const t = useT();
  const { locale } = useLocale();

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
    });

  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <h2 className="mb-3 text-base font-semibold text-ink">
        {t("circulars.recent.title")}
      </h2>
      {items.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          {t("circulars.recent.empty")}
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((c) => {
            const Icon = c.fileType === "pdf" ? FileText : ImageIcon;
            return (
              <li
                key={c.id}
                className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
              >
                <div className="flex min-w-0 items-center gap-2.5">
                  <Icon className="size-4 shrink-0 text-muted" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {c.title}
                    </p>
                    <p className="text-xs text-muted tabular-nums">
                      {fmtDate(c.createdAt)}
                    </p>
                  </div>
                </div>
                <a
                  href={c.fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-sm font-medium text-teal hover:underline"
                >
                  {t("circulars.recent.view")}
                </a>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
