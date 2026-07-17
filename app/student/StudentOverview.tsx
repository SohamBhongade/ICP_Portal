"use client";

// Student dashboard presentation — attendance %, outstanding fees.

import { CalendarCheck, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { balanceToneClass, formatCurrency } from "@/lib/fees";

export function StudentOverview({
  attendancePct,
  totalClasses,
  outstanding,
}: {
  attendancePct: number;
  totalClasses: number;
  outstanding: number;
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
          valueClassName={balanceToneClass(outstanding)}
        />
      </div>
    </div>
  );
}
