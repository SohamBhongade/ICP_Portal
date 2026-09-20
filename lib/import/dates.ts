// ONE date/year normaliser for every date-ish cell an import touches.
//
// WHY THIS FILE EXISTS
// --------------------
// D.O.B, Year of Admission and Year of Leaving used to arrive blank from every
// .xlsx upload. The cause was a mismatch nobody was told about:
//
//   lib/import/parse.ts reads a worksheet cell's RAW <v> value. It is a
//   purpose-built XLSX reader (see that file's header for why we don't use
//   SheetJS), and it carries no number-format table — so a cell FORMATTED as a
//   date in Excel arrives here as its underlying serial, the string "45231",
//   not as "2023-10-05". There is no `cellDates: true` to switch on; the
//   concept doesn't exist in our reader.
//
//   app/actions/import.ts then ran that through validateFieldValue(), which
//   demands a strict YYYY-MM-DD, and on failure did `continue` — dropping the
//   value with no error, no log, and no row failure. Caste (a `text` column)
//   sailed through; every `date` column was silently emptied.
//
// So the fix is two-part: parse what spreadsheets actually contain (here), and
// never discard a value without reporting it (the callers). This module is the
// first half, and it is PURE and CLIENT-SAFE on purpose — the import preview in
// the browser and the authoritative server import must show the identical
// answer, or the preview is a lie.
//
// DAY-FIRST IS THE DEFAULT. "03/04/2005" is 3 April 2005. This is an Indian
// university; staff type DD/MM/YYYY. Year-first is only assumed when the first
// component is unambiguously a 4-digit year ("2005-04-03").
//
// NO Date OBJECT EVER TOUCHES A STORED VALUE. Every conversion below is integer
// arithmetic on UTC civil dates, and the result is formatted from getUTC*.
// A local-time Date would shift a birthday to the previous day for every user
// east of Greenwich — which is all of them.

/** Why a cell could not be turned into a stored value. The UI translates these. */
export type DateIssue =
  /** Not recognizable as a date or year at all. */
  | "unreadable"
  /** Parsed, but the calendar date doesn't exist (31/02/2005, month 13). */
  | "impossible"
  /** Outside the range we accept (a typo like 20245, or a year before 1900). */
  | "outOfRange"
  /** A bare year ("2024") landed on a full-date column, where it has no day. */
  | "yearOnly";

export type CellOutcome<T> =
  | { ok: true; value: T }
  /** Blank cell. Not an error: an empty custom column is a normal state. */
  | { ok: true; value: null }
  | { ok: false; issue: DateIssue };

/** Widest year either parser will emit. Bounds typos in both directions. */
export const MIN_YEAR = 1900;
export const MAX_YEAR = 2100;

/**
 * Excel serial bounds we will interpret as a DATE.
 *
 *   61      = 1900-03-01. Serials below this sit inside Excel's fake
 *             1900-02-29 leap-year bug, where the epoch offset differs.
 *   73051   = 2100-01-01.
 *
 * Note this is deliberately wider than the range lib/academic-year.ts used to
 * use (36526 = 2000-01-01). That floor was fine for an admission year but wrong
 * for a birthday: a student born 1995-06-15 is serial 34865 and was rejected.
 */
const MIN_SERIAL = 61;
const MAX_SERIAL = 73051;

/**
 * Serial floor used when reading a YEAR, deliberately narrower: 36526 is
 * 2000-01-01.
 *
 * A year column receiving a serial means someone formatted an admission or
 * leaving year as an Excel date, which is always recent. Allowing the full date
 * window here would turn the typo "20245" into the year 1955 instead of
 * reporting it — the exact kind of confident-but-wrong guess this module is
 * meant to stop. A date column keeps the wide window because a birthday in
 * 1995 is ordinary.
 */
const MIN_YEAR_SERIAL = 36526;

/**
 * Excel's day 0. Serial 1 is 1900-01-01 and Excel believes 1900-02-29 existed,
 * so the conventional conversion is "days since 1899-12-30".
 */
const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const pad = (n: number) => String(n).padStart(2, "0");

/** Format Y/M/D as the stored, date-only shape. */
function isoOf(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

/**
 * Does this Y/M/D name a real day? Catches 31 February and month 13, which
 * a naive Date constructor would happily roll forward into March.
 */
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/**
 * Normalize the many shapes a cell can arrive in down to trimmed text.
 *
 * Handles the two non-string cases the pipeline can produce:
 *   - a real Date (a caller that did parse with a date-aware reader)
 *   - a number (an Excel serial that reached us untouched)
 *
 * And undoes the import's formula neutralization: lib/import/parse.ts prefixes
 * a cell starting with "-", "+", "=" or "@" with a single quote (the OWASP CSV
 * injection mitigation), so a date typed as "-" separated could arrive quoted.
 */
function asText(raw: unknown): string {
  if (raw == null) return "";
  if (raw instanceof Date) {
    return Number.isNaN(raw.getTime())
      ? ""
      : isoOf(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate());
  }
  if (typeof raw === "number") {
    return Number.isFinite(raw) ? String(raw) : "";
  }
  return String(raw).trim().replace(/^'/, "").trim();
}

/** True when the cell holds nothing at all. */
export function isBlankCell(raw: unknown): boolean {
  return asText(raw) === "";
}

/** Excel serial -> civil Y/M/D, by integer arithmetic (never local time). */
function serialToParts(
  serial: number,
  floor: number = MIN_SERIAL,
): { y: number; m: number; d: number } | null {
  if (!Number.isFinite(serial)) return null;
  const whole = Math.floor(serial);
  if (whole < floor || whole > MAX_SERIAL) return null;
  const dt = new Date(EXCEL_EPOCH_UTC + whole * 86_400_000);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

/**
 * Two-digit year -> four digits.
 *
 * 00–29 becomes 2000–2029 and 30–99 becomes 1930–1999. The pivot matters most
 * for D.O.B, where "95" is far likelier to be 1995 than 2095, and a student
 * born in "05" is 2005.
 */
function expandTwoDigitYear(n: number): number {
  return n <= 29 ? 2000 + n : 1900 + n;
}

/** Month name or number -> 1–12, or null. */
function monthFrom(token: string): number | null {
  const named = MONTH_NAMES[token.toLowerCase()];
  if (named) return named;
  if (/^\d{1,2}$/.test(token)) {
    const n = Number(token);
    return n >= 1 && n <= 12 ? n : null;
  }
  return null;
}

/**
 * Parse a FULL DATE out of one cell.
 *
 * Accepts, in this order of recognition:
 *   - an Excel serial number            45231        -> 2023-10-05
 *   - an ISO date or datetime           2005-04-03, 2005-04-03T00:00:00Z
 *   - year-first with any separator     2005/04/03
 *   - DAY-FIRST with any separator      03/04/2005, 03-04-2005, 3.4.05
 *   - a textual month either way round  15 Jun 2024, Jun 15 2024, 15-Jun-24
 *
 * A bare year ("2024") is REFUSED with `yearOnly` rather than guessed at — it
 * has no day and no month, and quietly inventing 1 January would be the same
 * class of silent damage this module exists to end. Year-shaped columns should
 * use the `year` field type instead; see normalizeYearCell.
 */
export function normalizeDateCell(raw: unknown): CellOutcome<string> {
  const text = asText(raw);
  if (!text) return { ok: true, value: null };

  // --- bare number: an Excel serial, or a year that lost its date -----------
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    // A 4-digit value inside the plausible year band is a YEAR, not serial
    // 2024 (= 1905-07-15). Say so instead of storing a fictional day.
    if (Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR) {
      return { ok: false, issue: "yearOnly" };
    }
    const parts = serialToParts(n);
    if (!parts) return { ok: false, issue: "outOfRange" };
    return { ok: true, value: isoOf(parts.y, parts.m, parts.d) };
  }

  // --- ISO date / datetime --------------------------------------------------
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/.exec(text);
  if (iso) {
    const [, y, m, d] = iso;
    return finishDate(Number(y), Number(m), Number(d));
  }

  // --- separated numeric / month-name forms --------------------------------
  const parts = text.split(/[\s/.\-,]+/).filter(Boolean);
  if (parts.length >= 3) {
    const [a, b, c] = parts;

    // YEAR-FIRST, only when the first token is unmistakably a 4-digit year.
    if (/^\d{4}$/.test(a)) {
      const m = monthFrom(b);
      if (m && /^\d{1,2}$/.test(c)) {
        return finishDate(Number(a), m, Number(c));
      }
    }

    // MONTH-NAME FIRST: "Jun 15 2024".
    const leadingMonth = MONTH_NAMES[a.toLowerCase()];
    if (leadingMonth && /^\d{1,2}$/.test(b) && /^\d{2,4}$/.test(c)) {
      return finishDate(yearFrom(c), leadingMonth, Number(b));
    }

    // DAY-FIRST — the default, and the only reading of "03/04/2005".
    if (/^\d{1,2}$/.test(a) && /^\d{2,4}$/.test(c)) {
      const m = monthFrom(b);
      if (m) return finishDate(yearFrom(c), m, Number(a));
    }
  }

  return { ok: false, issue: "unreadable" };
}

/** 2- or 4-digit year token -> full year. */
function yearFrom(token: string): number {
  const n = Number(token);
  return token.length <= 2 ? expandTwoDigitYear(n) : n;
}

/** Range-check and existence-check a parsed Y/M/D, then format it. */
function finishDate(y: number, m: number, d: number): CellOutcome<string> {
  if (!Number.isFinite(y) || y < MIN_YEAR || y > MAX_YEAR) {
    return { ok: false, issue: "outOfRange" };
  }
  if (!isRealDate(y, m, d)) return { ok: false, issue: "impossible" };
  return { ok: true, value: isoOf(y, m, d) };
}

/**
 * Parse a YEAR out of one cell.
 *
 * Year of Admission and Year of Leaving are conceptually YEARS, not timestamps,
 * so they are stored as a plain integer (built-in `users.admission_year`, and
 * the `year` custom-column type added alongside this module). That is why a
 * bare "2024" — which has nowhere valid to go on a DATE column — is the normal,
 * expected input here.
 *
 * Accepts:
 *   - a bare year                    2024            -> 2024
 *   - an academic year, START YEAR   2024-25, 2024/2025, AY 2024–25 -> 2024
 *   - an Excel serial                45231           -> 2023
 *   - any full date this module can read             -> its year
 */
export function normalizeYearCell(raw: unknown): CellOutcome<number> {
  const text = asText(raw);
  if (!text) return { ok: true, value: null };

  // --- bare number: a year, or a serial that carries one --------------------
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR) {
      return { ok: true, value: n };
    }
    const parts = serialToParts(n, MIN_YEAR_SERIAL);
    if (!parts) return { ok: false, issue: "outOfRange" };
    return { ok: true, value: parts.y };
  }

  // --- academic year ranges -------------------------------------------------
  // Every 4-digit year in the cell; the EARLIEST one is the start of the
  // academic year ("2024-25" -> 2024, "2024/2025" -> 2024). A trailing "-25" is
  // never a 4-digit match, so it can never win.
  const years = (text.match(/\b(?:19|20|21)\d{2}\b/g) ?? [])
    .map(Number)
    .filter((y) => y >= MIN_YEAR && y <= MAX_YEAR);
  if (years.length > 0) return { ok: true, value: Math.min(...years) };

  // --- a full date, whose year is what we want ------------------------------
  const asDate = normalizeDateCell(text);
  if (asDate.ok && asDate.value) {
    return { ok: true, value: Number(asDate.value.slice(0, 4)) };
  }

  // "24-25" — an academic year written with two-digit halves.
  const shortRange = /^(\d{2})\s*[-/–]\s*(\d{2})$/.exec(text);
  if (shortRange) return { ok: true, value: expandTwoDigitYear(Number(shortRange[1])) };

  return { ok: false, issue: "unreadable" };
}
