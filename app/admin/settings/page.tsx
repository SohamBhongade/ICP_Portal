// Admin Settings — Edit Mode home. Loads each dropdown category's active
// options server-side, then hands off to the client SettingsContent.

import {
  getDropdownOptions,
  type DropdownCategory,
} from "@/lib/edit-mode/settings";
import { SettingsContent } from "./SettingsContent";

const CATEGORIES: DropdownCategory[] = [
  "course",
  "class",
  "subject",
  "practical_batch",
  "semester",
];

export default async function SettingsPage() {
  const optionLists = await Promise.all(
    CATEGORIES.map((category) => getDropdownOptions(category)),
  );

  const groups = CATEGORIES.map((category, i) => ({
    category,
    options: optionLists[i].map((o) => ({
      id: o.id,
      value: o.value,
      label: o.label,
    })),
  }));

  return <SettingsContent groups={groups} />;
}
