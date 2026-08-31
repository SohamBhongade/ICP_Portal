"use client";

// Student fee dashboard — read-only StatCards (charged / paid / outstanding,
// tabular-nums) followed by the full transaction history. No mutation controls.

import { ArrowDownCircle, ArrowUpCircle, Wallet } from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  balanceToneClass,
  feeParticularsLabel,
  formatCurrency,
  type FeeBalances,
  type LedgerRow,
} from "@/lib/fees";

export function StudentFeesView({
  rows,
  balances,
}: {
  rows: LedgerRow[];
  balances: FeeBalances;
}) {
  const t = useT();

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="fees.student.title" />
        </h1>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label={t("fees.student.charged")}
          value={formatCurrency(balances.charged)}
          icon={ArrowUpCircle}
        />
        <StatCard
          label={t("fees.student.paid")}
          value={formatCurrency(balances.paid)}
          icon={ArrowDownCircle}
          tone="mint"
        />
        <StatCard
          label={t("fees.student.outstanding")}
          value={formatCurrency(balances.balance)}
          icon={Wallet}
          valueClassName={balanceToneClass(balances.balance)}
        />
      </div>

      <section className="rounded-lg border border-line bg-surface shadow-sm">
        <h2 className="border-b border-line px-4 py-3 text-base font-semibold text-ink">
          {t("fees.student.historyTitle")}
        </h2>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted">
            {t("fees.student.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
                  <th className="px-4 py-3 font-medium">{t("fees.colDate")}</th>
                  <th className="px-4 py-3 font-medium">
                    {t("fees.colParticulars")}
                  </th>
                  <th className="px-4 py-3 font-medium">{t("fees.colReceipt")}</th>
                  <th className="px-4 py-3 font-medium">{t("fees.colType")}</th>
                  <th className="px-4 py-3 text-right font-medium">
                    {t("fees.colAmount")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id} className="border-b border-line last:border-0">
                    <td className="whitespace-nowrap px-4 py-3 text-muted tabular-nums">
                      {row.date}
                    </td>
                    {/* Mapped through the shared category table so a label
                        rename reaches historical rows too — the stored value
                        itself is never rewritten. */}
                    <td className="px-4 py-3 text-ink">
                      {feeParticularsLabel(row.particulars, t)}
                    </td>
                    <td className="px-4 py-3 text-muted">
                      {row.receiptNo ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                          row.type === "charge"
                            ? "bg-lavender text-danger"
                            : "bg-mint text-teal"
                        }`}
                      >
                        {t(
                          row.type === "charge"
                            ? "fees.typeCharge"
                            : "fees.typePayment",
                        )}
                      </span>
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-medium tabular-nums ${
                        row.type === "charge" ? "text-danger" : "text-teal"
                      }`}
                    >
                      {formatCurrency(row.amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
