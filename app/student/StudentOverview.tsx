"use client";

// Student dashboard presentation — attendance %, outstanding fees, recent feed.

import { CalendarCheck, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { RecentCirculars } from "@/components/circulars/RecentCirculars";
import type { CircularItem } from "@/components/circulars/CircularsBoard";
import { formatCurrency } from "@/lib/fees";

export function StudentOverview({
  attendancePct,
  totalClasses,
  outstanding,
  circulars,
}: {
  attendancePct: number;
  totalClasses: number;
  outstanding: number;
  circulars: CircularItem[];
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard
          label={t("dashboard.statAttendanceRate")}
          value={totalClasses ? `${attendancePct}%` : "—"}
          icon={CalendarCheck}
          tone="mint"
        />
        <StatCard
          label={t("dashboard.statFeeBalance")}
          value={formatCurrency(outstanding)}
          icon={Wallet}
        />
      </div>

      <RecentCirculars items={circulars} />
    </div>
  );
}
