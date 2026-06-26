// Small date-range helpers for analytics. Attendance + fee dates are stored as
// 'YYYY-MM-DD' text, so these return ISO string bounds usable with gte/lte
// (lexicographic comparison is correct for zero-padded ISO dates).

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** First and last day of the current calendar month. */
export function monthBounds(now = new Date()): { start: string; end: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  return { start: `${y}-${pad(m + 1)}-01`, end: iso(new Date(y, m + 1, 0)) };
}

/** Monday and Sunday bounding the current ISO week. */
export function weekBounds(now = new Date()): { start: string; end: string } {
  const dayFromMonday = (now.getDay() + 6) % 7; // 0 = Monday … 6 = Sunday
  const monday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() - dayFromMonday,
  );
  const sunday = new Date(
    monday.getFullYear(),
    monday.getMonth(),
    monday.getDate() + 6,
  );
  return { start: iso(monday), end: iso(sunday) };
}
