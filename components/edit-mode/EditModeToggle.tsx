"use client";

// Admin-only Edit Mode switch for the dashboard header. Renders nothing for
// non-admins.

import { Pencil } from "lucide-react";
import { useEditMode } from "./EditModeProvider";
import { useT } from "@/components/i18n/LanguageProvider";

export function EditModeToggle() {
  const { canEdit, editMode, toggle, pending } = useEditMode();
  const t = useT();

  if (!canEdit) return null;

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-pressed={editMode}
      className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors disabled:opacity-60 ${
        editMode
          ? "border-teal bg-teal text-teal-foreground"
          : "border-line text-ink hover:bg-lavender"
      }`}
    >
      <Pencil className="size-4" aria-hidden />
      {t("editMode.label")}: {editMode ? t("editMode.on") : t("editMode.off")}
    </button>
  );
}
