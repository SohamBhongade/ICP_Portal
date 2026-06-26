"use client";

// Teacher dashboard presentation — classes conducted this week + recent circulars.

import { CalendarCheck } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { RecentCirculars } from "@/components/circulars/RecentCirculars";
import type { CircularItem } from "@/components/circulars/CircularsBoard";

export function TeacherOverview({
  classesThisWeek,
  circulars,
}: {
  classesThisWeek: number;
  circulars: CircularItem[];
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

      <RecentCirculars items={circulars} />
    </div>
  );
}
