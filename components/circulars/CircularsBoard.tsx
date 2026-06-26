"use client";

// Chronological notice board. Every role reads it; staff (canManage) also get a
// delete control. Files open in a new tab for view/download — images and PDFs
// are linked by their Cloudinary URL, badged by type.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, ImageIcon, Trash2 } from "lucide-react";
import { useT, useLocale } from "@/components/i18n/LanguageProvider";
import { deleteCircularAction } from "@/app/actions/support";

export type CircularItem = {
  id: number;
  title: string;
  description: string | null;
  fileUrl: string;
  fileType: "pdf" | "image";
  createdAt: number; // epoch ms
  uploaderName: string | null;
};

export function CircularsBoard({
  circulars,
  canManage = false,
}: {
  circulars: CircularItem[];
  canManage?: boolean;
}) {
  const t = useT();
  const { locale } = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<number | null>(null);

  const fmtDate = (ms: number) =>
    new Date(ms).toLocaleDateString(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const remove = (id: number) => {
    if (!window.confirm(t("circulars.board.confirmDelete"))) return;
    setDeletingId(id);
    startTransition(async () => {
      await deleteCircularAction(id);
      setDeletingId(null);
      router.refresh();
    });
  };

  if (circulars.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center">
        <FileText className="mx-auto mb-2 size-8 text-muted" />
        <p className="text-sm text-muted">{t("circulars.board.empty")}</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {circulars.map((c) => {
        const Icon = c.fileType === "pdf" ? FileText : ImageIcon;
        return (
          <li
            key={c.id}
            className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 shadow-sm sm:flex-row sm:items-start sm:justify-between"
          >
            <div className="flex min-w-0 gap-3">
              <span className="mt-0.5 shrink-0 rounded-md bg-lavender p-2 text-primary">
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-semibold text-ink">
                  {c.title}
                </h3>
                {c.description && (
                  <p className="mt-0.5 text-sm text-muted">{c.description}</p>
                )}
                <p className="mt-1 text-xs text-muted">
                  {t("circulars.board.postedOn", { date: fmtDate(c.createdAt) })}
                  {c.uploaderName
                    ? ` · ${t("circulars.board.by", { name: c.uploaderName })}`
                    : ""}
                  {" · "}
                  <span className="uppercase">
                    {t(`circulars.type.${c.fileType}`)}
                  </span>
                </p>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <a
                href={c.fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-ink hover:bg-mint"
              >
                <Download className="size-4" /> {t("circulars.board.view")}
              </a>
              {canManage && (
                <button
                  type="button"
                  onClick={() => remove(c.id)}
                  disabled={pending && deletingId === c.id}
                  aria-label={t("circulars.board.delete")}
                  className="inline-flex items-center justify-center rounded-md border border-line p-1.5 text-danger hover:bg-lavender disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
