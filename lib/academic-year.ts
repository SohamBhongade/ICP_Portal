// Admission year + year-of-study helpers. Pure and client-safe (no db import),
// so the import preview, the import action, the Users grid and the Fees tab all
// read a year exactly the same way.
//
// ADMISSION YEAR is stored as a plain 4-digit year (users.admission_year).
// Colleges write it as an ACADEMIC year — "2024-25", "2024-2025", "2024/25" —
// and the rule is: the EARLIER year of the range is the year of admission.
//   "2024-2025" -> 2024      "2024-25" -> 2024      "2024" -> 2024
// A full date ("2024-06-15", "15/06/2024") also works: its year is taken.
//
// The actual cell reading now lives in lib/import/dates.ts, which is the ONE
// normaliser every date-ish import field shares — Excel serials, ISO strings,
// day-first DD/MM/YYYY, month names and academic-year ranges all resolve the
// same way here as they do for D.O.B and Year of Leaving. This module keeps the
// admission-specific policy on top of it: a floor of 1950, so a typo like
// "20245" or a stray "1905" is refused rather than stored.

import { normalizeYearCell } from "./import/dates";

/** Earliest / latest admission year accepted. Bounds out typos like "20245". */
const MIN_ADMISSION_YEAR = 1950;
const MAX_ADMISSION_YEAR = 2100;

/**
 * Read a year of admission out of any cell a college sheet is likely to hold.
 * Returns null when the cell is blank or holds nothing year-like.
 */
export function parseAdmissionYear(
  raw: string | number | null | undefined,
): number | null {
  const out = normalizeYearCell(raw);
  if (!out.ok || out.value == null) return null;
  return out.value >= MIN_ADMISSION_YEAR && out.value <= MAX_ADMISSION_YEAR
    ? out.value
    : null;
}

/**
 * Same reading, but it distinguishes "blank" from "unreadable" so the importer
 * can REPORT a cell it could not use instead of quietly leaving the column
 * empty. `parseAdmissionYear` stays for the call sites that only want a value.
 */
export type AdmissionYearOutcome =
  | { ok: true; value: number | null }
  | { ok: false };

export function readAdmissionYear(
  raw: string | number | null | undefined,
): AdmissionYearOutcome {
  const out = normalizeYearCell(raw);
  if (!out.ok) return { ok: false };
  if (out.value == null) return { ok: true, value: null };
  return out.value >= MIN_ADMISSION_YEAR && out.value <= MAX_ADMISSION_YEAR
    ? { ok: true, value: out.value }
    : { ok: false };
}

// ---------------------------------------------------------------------------
// Year of study (1st – 4th year)
// ---------------------------------------------------------------------------

export const STUDY_YEARS = [1, 2, 3, 4] as const;

/** i18n key for a year of study, e.g. 1 -> "common.studyYear.1" ("1st year"). */
export function studyYearLabelKey(year: number): string {
  return `common.studyYear.${year}`;
}
