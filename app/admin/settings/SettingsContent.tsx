"use client";

// Settings / Edit Mode demo content. Proves <Editable> (text overrides) and
// <EditableDropdown> (dropdown management) work end-to-end. Toggle "Edit mode"
// in the header to reveal the editing affordances.

import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  EditableDropdown,
  type DropdownOptionItem,
} from "@/components/edit-mode/EditableDropdown";
import type { DropdownCategory } from "@/lib/edit-mode/settings";

export function SettingsContent({
  groups,
}: {
  groups: { category: DropdownCategory; options: DropdownOptionItem[] }[];
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {/* Editable text demo */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">
          {t("settings.editableText")}
        </h2>
        <p className="mt-1 text-sm text-muted">{t("settings.editableTextHint")}</p>
        <p className="mt-4 text-lg text-ink">
          <Editable tKey="settings.sampleText" />
        </p>
      </section>

      {/* Dropdown management */}
      <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <h2 className="text-base font-semibold text-ink">
          {t("settings.dropdowns")}
        </h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g.category}>
              <label className="mb-1 block text-sm font-medium text-ink">
                {t(`dropdownCategory.${g.category}`)}
              </label>
              <EditableDropdown
                category={g.category}
                options={g.options}
                placeholder="—"
              />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
