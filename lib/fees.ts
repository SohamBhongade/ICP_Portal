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

// ---------------------------------------------------------------------------
// Fee categories (Phase 10)
// ---------------------------------------------------------------------------
//
// THE VALUE/LABEL SPLIT IS THE WHOLE POINT OF THIS TABLE.
//
//   `value` is what gets WRITTEN to fee_ledgers.particulars. It is an
//           identifier, it is already present in historical rows, and it must
//           never change. Renaming it would orphan every entry ever posted
//           under the old string, because particulars is free text with no
//           foreign key to rehydrate from.
//
//   `labelKey` is an i18n key. Renaming a category is a one-line edit to
//           messages/en.json and touches no data at all.
//
// These were previously two hardcoded arrays inside FeesAdmin.tsx, which meant
// the admin form knew about categories and the two ledger views did not — so
// both rendered the raw stored value. That is why a label rename used to be
// invisible in the ledger. `feeParticularsLabel` below closes that gap.

export type FeeCategory = {
  /** Immutable stored value. Written to fee_ledgers.particulars. */
  value: string;
  /** i18n key for the display label. Safe to re-point at any time. */
  labelKey: string;
  /** Which side of the ledger this category may be posted on. */
  side: LedgerType;
};

/**
 * Every category the admin form offers, in display order.
 *
 * Payment-side "Library Fees" / "Development Fees" earmark a payment against a
 * specific charge line. Their stored values are deliberately DISTINCT from the
 * charge-side values ("Library fee" vs "Library fee payment") so that a raw
 * `particulars` string is never ambiguous about which side it came from — which
 * matters because particulars is the only thing an export or a manual DB query
 * has to go on.
 */
export const FEE_CATEGORIES: readonly FeeCategory[] = [
  // --- Charges ---
  { value: "Tuition fee", labelKey: "fees.cat.tuition", side: "charge" },
  { value: "Library fee", labelKey: "fees.cat.library", side: "charge" },
  { value: "Development fees", labelKey: "fees.cat.development", side: "charge" },
  { value: "Other charge", labelKey: "fees.cat.otherCharge", side: "charge" },

  // --- Payments ---
  { value: "Cash payment", labelKey: "fees.cat.cash", side: "payment" },
  { value: "Online payment", labelKey: "fees.cat.online", side: "payment" },
  {
    value: "Library fee payment",
    labelKey: "fees.cat.libraryPayment",
    side: "payment",
  },
  {
    value: "Development fees payment",
    labelKey: "fees.cat.developmentPayment",
    side: "payment",
  },
  // A scholarship is a PAYMENT, not a negative charge: it credits the student's
  // account, so it increases `paid` and therefore REDUCES what they owe under
  // balance = paid - charged. See the note on computeBalances.
  { value: "Scholarship (fund)", labelKey: "fees.cat.scholarship", side: "payment" },
  { value: "Other payment", labelKey: "fees.cat.otherPayment", side: "payment" },
];

export function feeCategoriesFor(side: LedgerType): FeeCategory[] {
  return FEE_CATEGORIES.filter((c) => c.side === side);
}

/** Stored value -> category. Built once; values are unique by construction. */
const CATEGORY_BY_VALUE = new Map(FEE_CATEGORIES.map((c) => [c.value, c]));

/**
 * Separator the admin form uses between the category and the operator's note:
 * `particulars = "<category value> — <note>"`. Kept here so the writer and the
 * reader below can never disagree about it.
 */
export const PARTICULARS_SEPARATOR = " — ";

/**
 * Render a stored `particulars` string using the CURRENT display labels.
 *
 * This is what makes a rename actually take effect. The stored value stays
 * exactly as written — including on rows posted years ago — and the label is
 * resolved at render time, so historical and new entries always read the same.
 *
 * Anything unrecognized falls through verbatim: particulars is free text, rows
 * predating this table exist, and a row imported or hand-edited outside the
 * form must still display something truthful rather than being swallowed.
 *
 * @param particulars raw column value
 * @param t           translator (useT() on the client, getT() on the server)
 */
export function feeParticularsLabel(
  particulars: string,
  t: (key: string) => string,
): string {
  const at = particulars.indexOf(PARTICULARS_SEPARATOR);
  const head = at === -1 ? particulars : particulars.slice(0, at);
  const note = at === -1 ? "" : particulars.slice(at);

  const category = CATEGORY_BY_VALUE.get(head);
  if (!category) return particulars; // unknown / free-text: show it as stored
  return t(category.labelKey) + note;
}
