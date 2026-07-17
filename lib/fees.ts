// Pure fee-ledger helpers + shared types. NO "use server" and NO db/server-only
// imports here, so this module is safe to import from BOTH server actions and
// client components (the balance maths must agree on both sides).
//
// Design rule (see db/schema.ts): a balance is COMPUTED (payments − charges),
// never stored, so editing an old row can never desync a running total.
// A negative balance means the student still owes; positive means overpaid.

export type LedgerType = "charge" | "payment";

/** One ledger entry, already shaped for display (date is 'YYYY-MM-DD' text). */
export type LedgerRow = {
  id: number;
  date: string;
  particulars: string;
  type: LedgerType;
  amount: number;
  receiptNo: string | null;
};

export type FeeBalances = {
  charged: number; // sum of all charges
  paid: number; // sum of all payments
  balance: number; // outstanding = paid − charged (negative = owes, positive = overpaid)
};

/** Sum charges/payments into a net outstanding balance (paid − charged). */
export function computeBalances(
  rows: { type: LedgerType; amount: number }[],
): FeeBalances {
  let charged = 0;
  let paid = 0;
  for (const r of rows) {
    if (r.type === "charge") charged += r.amount;
    else paid += r.amount;
  }
  return { charged, paid, balance: paid - charged };
}

/**
 * Text-color class for an outstanding balance under the paid − charged
 * convention: negative = still owes (danger), positive = overpaid (success),
 * zero = settled (neutral ink).
 */
export function balanceToneClass(balance: number): string {
  if (balance < 0) return "text-danger";
  if (balance > 0) return "text-success";
  return "text-ink";
}

/** ₹ with Indian digit grouping. Locale-stable so server and client agree. */
export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(amount);
}
