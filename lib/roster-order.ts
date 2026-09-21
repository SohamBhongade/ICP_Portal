// Default roster order: admission year, then roll number — both ascending.
//
//   2024 -> 1, 2, 3 … 20      2025 -> 1, 2, 3 … 60
//
// Pure and client-safe, because the Users grid and the Fees student picker
// must list the same students in the same order; an office clerk reading one
// screen and then the other should not have to re-find their place.
//
// Roll numbers are TEXT (a college may write "1", "DP24-01" or "25/2"), so a
// plain string sort puts "10" before "2". `compareRollNumbers` compares digit
// runs as numbers and everything else as text, which orders all three styles
// the way a person reads them.

const collator = new Intl.Collator("en", { sensitivity: "base" });

export function compareRollNumbers(a: string, b: string): number {
  // Split into digit / non-digit runs: "DP24-01" -> ["DP", "24", "-", "01"].
  const partsA = a.match(/\d+|\D+/g) ?? [];
  const partsB = b.match(/\d+|\D+/g) ?? [];
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    const x = partsA[i];
    const y = partsB[i];
    const bothNumeric = /^\d/.test(x) && /^\d/.test(y);
    const diff = bothNumeric ? Number(x) - Number(y) : collator.compare(x, y);
    if (diff !== 0) return diff;
  }
  return partsA.length - partsB.length;
}

/** The fields the ordering reads. Both grids' row types satisfy this. */
export type RosterEntry = {
  fullName: string;
  studentId: string | null;
  admissionYear: number | null;
  /** Absent on lists that are students-only (the Fees picker). */
  role?: string;
};

/**
 * Sort comparator for a roster.
 *
 * Rows with no admission year sort after those that have one, and non-students
 * (staff, admins — no roll number, no intake) sort last by name, so they never
 * break up a class.
 */
export function compareRosterEntries(a: RosterEntry, b: RosterEntry): number {
  const aStudent = a.role === undefined || a.role === "student";
  const bStudent = b.role === undefined || b.role === "student";
  if (aStudent !== bStudent) return aStudent ? -1 : 1;
  if (!aStudent) return collator.compare(a.fullName, b.fullName);

  // Students: intake year first. No year recorded -> after every known year.
  const ay = a.admissionYear ?? Number.POSITIVE_INFINITY;
  const by = b.admissionYear ?? Number.POSITIVE_INFINITY;
  if (ay !== by) return ay - by;

  // Then roll number. A student with no roll number sorts last in their year.
  const ar = a.studentId?.trim() ?? "";
  const br = b.studentId?.trim() ?? "";
  if (!ar || !br) {
    if (ar !== br) return ar ? -1 : 1;
    return collator.compare(a.fullName, b.fullName);
  }
  const byRoll = compareRollNumbers(ar, br);
  return byRoll !== 0 ? byRoll : collator.compare(a.fullName, b.fullName);
}
