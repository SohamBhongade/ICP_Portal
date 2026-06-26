"use client";

// Admin dashboard presentation — live StatCards + recent circulars feed.

import { LifeBuoy, Users, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { RecentCirculars } from "@/components/circulars/RecentCirculars";
import type { CircularItem } from "@/components/circulars/CircularsBoard";
import { formatCurrency } from "@/lib/fees";

export function AdminOverview({
  activeStudents,
  pendingTickets,
  feesThisMonth,
  circulars,
}: {
  activeStudents: number;
  pendingTickets: number;
  feesThisMonth: number;
  circulars: CircularItem[];
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

      <RecentCirculars items={circulars} />
    </div>
  );
}
