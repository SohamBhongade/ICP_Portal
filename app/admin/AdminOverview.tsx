"use client";

// Admin dashboard presentation — live StatCards.

import { LifeBuoy, Users, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { formatCurrency } from "@/lib/fees";

export function AdminOverview({
  activeStudents,
  pendingTickets,
  feesThisMonth,
}: {
  activeStudents: number;
  pendingTickets: number;
  feesThisMonth: number;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t("dashboard.statActiveStudents")}
          value={String(activeStudents)}
          icon={Users}
        />
        <StatCard
          label={t("dashboard.statPendingTickets")}
          value={String(pendingTickets)}
          icon={LifeBuoy}
        />
        <StatCard
          label={t("dashboard.statFeesThisMonth")}
          value={formatCurrency(feesThisMonth)}
          icon={Wallet}
          tone="mint"
        />
      </div>
    </div>
  );
}
