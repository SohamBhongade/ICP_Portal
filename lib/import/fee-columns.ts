// Fee columns in the student import — pure helpers shared by the import dialog
// (preview) and the import server action (authoritative write).
//
// NO "use server" and NO db imports: the preview and the server must compute
// the exact same ledger lines from the exact same cells, so the maths lives
// here once and both sides call it.
//
// How it works:
//   - Every FEE_CATEGORY becomes a mapping target addressed as `fee:<value>`
//     (e.g. `fee:Tuition fee`). The admin maps a spreadsheet column onto it,
//     exactly like mapping "Email" or a custom column.
//   - Each mapped cell becomes ONE fee_ledgers row on that category's side:
//     charge categories raise what the student owes, payment categories
//     (Scholarship, Cash, …) credit it. Balance stays COMPUTED — nothing here
//     stores a total.
//   - Blank / 0 / "-" cells post nothing, so a sheet with a 0 in the
//     scholarship column does not litter the ledger with ₹0 rows.

import {
  FEE_CATEGORIES,
  PARTICULARS_SEPARATOR,
  type FeeCategory,
  type LedgerType,
} from "@/lib/fees";

/** Mapping-target prefix for fee columns. Mirrors `custom:` for user fields. */
export const FEE_TARGET_PREFIX = "fee:";

export const feeTargetKey = (categoryValue: string) =>
  `${FEE_TARGET_PREFIX}${categoryValue}`;

const CATEGORY_BY_TARGET = new Map(
  FEE_CATEGORIES.map((c) => [feeTargetKey(c.value), c]),
);

/** Resolve a mapping key to its fee category, or null if it isn't a fee target. */
export function feeCategoryForTarget(target: string): FeeCategory | null {
  return CATEGORY_BY_TARGET.get(target) ?? null;
}

// Stored values of the two categories the "scholarship on top" option links.
export const TUITION_VALUE = "Tuition fee";
export const SCHOLARSHIP_VALUE = "Scholarship (fund)";

/**
 * Header substrings used to auto-suggest a mapping. Matched against the header
 * lower-cased with every non-alphanumeric removed. Common misspellings seen in
 * real college sheets ("Tution", "Devlopment", "Scolarship") are included on
 * purpose. Categories without an entry are never auto-mapped — the admin picks.
 */
export const FEE_TARGET_GUESSES: Record<string, string[]> = {
  "Tuition fee": ["tuition", "tution", "tutionfee"],
  "Development fees": ["development", "devlopment", "developement"],
  "Library fee": ["library"],
  "Scholarship (fund)": ["scholarship", "scolarship", "scholership"],
};

/** Largest single amount accepted — matches `moneyAmount` in validation/core. */
const MAX_AMOUNT = 10_000_000;

/** Cells that mean "nothing" in a fee column. Compared lower-cased. */
const BLANK_TOKENS = new Set(["", "-", "'-", "–", "na", "n/a", "nil", "none"]);

export type FeeAmount =
  | { ok: true; amount: number | null } // null = blank / zero -> post nothing
  | { ok: false };

/**
 * Read a money cell. Accepts `45455`, `45,455`, `₹ 45,455.00`, `Rs. 22727.5`,
 * and the float noise xlsx sometimes stores (`22727.499999999996` -> 22727.5).
 * Rejects negatives, text, and anything over the ledger's ceiling — a bad cell
 * fails the ROW, it is never silently read as 0.
 */
export function parseFeeAmount(raw: string | undefined | null): FeeAmount {
  const text = (raw ?? "").trim();
  if (BLANK_TOKENS.has(text.toLowerCase())) return { ok: true, amount: null };

  const cleaned = text
    .replace(/^(₹|rs\.?|inr)\s*/i, "")
    .replace(/[,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(cleaned)) return { ok: false };

  const amount = Math.round(Number(cleaned) * 100) / 100;
  if (!Number.isFinite(amount) || amount > MAX_AMOUNT) return { ok: false };
  return { ok: true, amount: amount === 0 ? null : amount };
}

export type FeeImportOptions = {
  /**
   * True when the tuition column holds only the STUDENT's share and the
   * scholarship column holds the rest (e.g. Tuition 0 + Scholarship 45 455 for
   * a fully-funded student). The tuition CHARGE then becomes tuition +
   * scholarship, and the scholarship is credited against it — so the ledger
   * shows the full fee, the scholarship, and the correct amount still due.
   * Without this, a fully-funded student would show a ₹45 455 credit.
   */
  scholarshipOnTop: boolean;
};

export type FeeLine = {
  category: FeeCategory;
  type: LedgerType;
  amount: number;
};

export type RowFeeResult =
  | { ok: true; lines: FeeLine[] }
  | { ok: false; category: FeeCategory };

/**
 * Turn one mapped row's fee cells into ledger lines.
 *
 * @param cells category value -> raw cell text, for every MAPPED fee category
 */
export function buildFeeLines(
  cells: Record<string, string | undefined>,
  options: FeeImportOptions,
): RowFeeResult {
  const amounts = new Map<string, number>();
  for (const category of FEE_CATEGORIES) {
    if (!(category.value in cells)) continue;
    const parsed = parseFeeAmount(cells[category.value]);
    if (!parsed.ok) return { ok: false, category };
    if (parsed.amount !== null) amounts.set(category.value, parsed.amount);
  }

  if (
    options.scholarshipOnTop &&
    TUITION_VALUE in cells &&
    SCHOLARSHIP_VALUE in cells
  ) {
    const scholarship = amounts.get(SCHOLARSHIP_VALUE) ?? 0;
    if (scholarship > 0) {
      const tuition = (amounts.get(TUITION_VALUE) ?? 0) + scholarship;
      amounts.set(TUITION_VALUE, Math.round(tuition * 100) / 100);
    }
  }

  const lines: FeeLine[] = [];
  for (const category of FEE_CATEGORIES) {
    const amount = amounts.get(category.value);
    if (amount) lines.push({ category, type: category.side, amount });
  }
  return { ok: true, lines };
}

/** Net effect of a row's lines under paid − charged (negative = owes). */
export function feeLinesBalance(lines: FeeLine[]): number {
  let balance = 0;
  for (const l of lines) balance += l.type === "payment" ? l.amount : -l.amount;
  return Math.round(balance * 100) / 100;
}

/** The `particulars` string a line is stored under: "<category> — <note>". */
export function feeLineParticulars(line: FeeLine, note: string): string {
  const trimmed = note.trim();
  return trimmed
    ? `${line.category.value}${PARTICULARS_SEPARATOR}${trimmed}`
    : line.category.value;
}
