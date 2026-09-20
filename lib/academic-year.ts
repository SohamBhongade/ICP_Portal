// Admission year + year-of-study helpers. Pure and client-safe (no db import),
// so the import preview, the import action, the Users grid and the Fees tab all
// read a year exactly the same way.
//
// ADMISSION YEAR is stored as a plain 4-digit year (users.admission_year).
// Colleges write it as an ACADEMIC year — "2024-25", "2024-2025", "2024/25" —
// and the rule is: the EARLIER year of the range is the year of admission.
//   "2024-2025" -> 2024      "2024-25" -> 2024      "2024" -> 2024
// A full date ("2024-06-15", "15/06/2024") also works: its year is taken.

/** Earliest / latest admission year accepted. Bounds out typos like "20245". */
const MIN_YEAR = 1950;
const MAX_YEAR = 2100;

/**
 * Excel stores a cell formatted as a DATE as a serial day number (45458 is
 * 15 Jun 2024). Serial 1 = 1900-01-01, with Excel's fake 1900-02-29, so the
 * standard conversion is days since 1899-12-30.
 */
function excelSerialYear(serial: number): number | null {
  // 36526 = 2000-01-01, 73051 = 2100-01-01. Anything outside that is treated
  // as "not a date" rather than guessed at — so a typo like "20245" is
  // rejected instead of silently becoming 1955.
  if (serial < 36526 || serial > 73051) return null;
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(ms).getUTCFullYear();
}

/**
 * Read a year of admission out of any cell a college sheet is likely to hold.
 * Returns null when the cell is blank or holds nothing year-like.
 */
export function parseAdmissionYear(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === "number") {
    return Number.isInteger(raw) && raw >= MIN_YEAR && raw <= MAX_YEAR
      ? raw
      : excelSerialYear(raw);
  }
  // The import neutralizes a leading "-"/"+"/"=" by prefixing "'"; undo that.
  const text = raw.trim().replace(/^'/, "");
  if (!text) return null;

  // A bare number: either a year or an Excel date serial.
  if (/^\d+(\.\d+)?$/.test(text)) {
    const n = Number(text);
    if (Number.isInteger(n) && n >= MIN_YEAR && n <= MAX_YEAR) return n;
    return excelSerialYear(n);
  }

  // Every 4-digit year in the cell, e.g. "2024-2025" -> [2024, 2025].
  const years = (text.match(/\b(19|20)\d{2}\b/g) ?? [])
    .map(Number)
    .filter((y) => y >= MIN_YEAR && y <= MAX_YEAR);
  if (years.length === 0) return null;
  // The earliest year is the year of admission ("2024-25" -> 2024). A short
  // second half like "-25" is never a 4-digit match, so it can't win.
  return Math.min(...years);
}

// ---------------------------------------------------------------------------
// Year of study (1st – 4th year)
// ---------------------------------------------------------------------------

export const STUDY_YEARS = [1, 2, 3, 4] as const;

/** i18n key for a year of study, e.g. 1 -> "common.studyYear.1" ("1st year"). */
export function studyYearLabelKey(year: number): string {
  return `common.studyYear.${year}`;
}
