"use client";

// <Editable tKey="some.key" /> renders a translated string. For admins with Edit
// Mode on, it becomes click-to-edit: the edited value is saved to text_overrides
// for the CURRENT locale and overlays the JSON dictionary (see lib/i18n).

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, Pencil, X } from "lucide-react";
import { useT, useLocale } from "@/components/i18n/LanguageProvider";
import { useEditMode } from "./EditModeProvider";
import { saveTextOverrideAction } from "@/app/actions/edit-mode";

export function Editable({
  tKey,
  multiline = false,
  className,
}: {
  tKey: string;
  multiline?: boolean;
  className?: string;
}) {
  const t = useT();
  const { locale } = useLocale();
  const { editing } = useEditMode();
  const router = useRouter();

  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [pending, startTransition] = useTransition();

  const current = t(tKey);

  if (!editing) return <span className={className}>{current}</span>;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(current);
          setOpen(true);
        }}
        title={tKey}
        className={`group inline-flex items-center gap-1 rounded border border-dashed border-teal/50 px-1 text-left hover:bg-mint/40 ${className ?? ""}`}
      >
        <span>{current}</span>
        <Pencil className="size-3 text-teal opacity-60 group-hover:opacity-100" aria-hidden />
      </button>
    );
  }

  const save = () =>
    startTransition(async () => {
      await saveTextOverrideAction(locale, tKey, value);
      setOpen(false);
      router.refresh();
    });

  return (
    <span className="inline-flex items-center gap-1 align-middle">
      {multiline ? (
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={2}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-teal"
        />
      ) : (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-teal"
        />
      )}
      <button
        type="button"
        onClick={save}
        disabled={pending}
        aria-label={t("common.save")}
        className="rounded p-1 text-teal hover:bg-mint disabled:opacity-50"
      >
        <Check className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label={t("common.cancel")}
        className="rounded p-1 text-muted hover:bg-lavender"
      >
        <X className="size-4" />
      </button>
    </span>
  );
}
