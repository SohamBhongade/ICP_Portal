"use client";

// Teacher dashboard presentation — classes conducted this week.

import { CalendarCheck } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";

export function TeacherOverview({
  classesThisWeek,
}: {
  classesThisWeek: number;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label={t("dashboard.statClassesThisWeek")}
          value={String(classesThisWeek)}
          icon={CalendarCheck}
          tone="mint"
        />
      </div>
    </div>
  );
}
