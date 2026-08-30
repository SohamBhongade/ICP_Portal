// Date helpers. Attendance + fee dates are stored as 'YYYY-MM-DD' text, so the
// range helpers return ISO string bounds usable with gte/lte (lexicographic
// comparison is correct for zero-padded ISO dates).
//
// ---------------------------------------------------------------------------
// WHY THIS FILE PINS A TIME ZONE
// ---------------------------------------------------------------------------
// Everything here used to run on "whatever zone this process happens to be in".
// That is two different answers in one app: Vercel runs the server in UTC, and
// the browser runs in the visitor's local zone. The college is in India
// (UTC+5:30), so for five and a half hours of every day the two disagree about
// what "today" is. That produced two real bugs:
//
//   1. HYDRATION MISMATCH. A date formatted during SSR and again during
//      hydration rendered different text, so React reported a mismatch and the
//      value visibly changed after load.
//   2. A REJECTED SUBMISSION. The attendance form defaulted to the browser's
//      today (IST) while the server's backdate guard compared against the
//      server's today (UTC) — so after 18:30 UTC the form pre-filled a date the
//      server then refused as `futureDate`.
//
// Pinning one zone for both sides removes the whole class of problem: server and
// client now always agree, by construction.
//
// If the college ever operates from another zone, change DISPLAY_TIME_ZONE and
// nothing else.

/** The institution's operating time zone. One source of truth. */
export const DISPLAY_TIME_ZONE = "Asia/Kolkata";
/** Fixed formatting locale, so output never depends on the host's default. */
export const DISPLAY_LOCALE = "en-IN";

/**
 * Format a date for DISPLAY, deterministically.
 *
 * Both the locale and the time zone are fixed, so this returns the same string
 * on the server and in the browser — which is what makes it safe to call during
 * render in a Client Component.
 *
 * Never use `toLocaleDateString()` directly in a component: omitting the locale
 * falls back to the host default (server and client differ), and omitting the
 * time zone falls back to the host zone (server and client differ).
 */
export function formatDisplayDate(
  value: Date | string | number | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    day: "numeric",
    month: "short",
    year: "numeric",
  },
): string {
  if (value == null) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString(DISPLAY_LOCALE, {
    ...options,
    timeZone: DISPLAY_TIME_ZONE,
  });
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function iso(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Today as 'YYYY-MM-DD' in the INSTITUTION's time zone.
 *
 * Deliberately not the host's zone. This one function is consulted by both
 * sides of the attendance flow — the client uses it to pre-fill the date input,
 * the server's backdate guard uses it to decide whether a submission is
 * back-dated — so if it answered "whatever zone I am running in" the two would
 * disagree for part of every day. See the file header.
 */
export function todayIso(now = new Date()): string {
  // en-CA formats as YYYY-MM-DD, which is exactly the stored shape, so this
  // avoids hand-rolling the zone offset arithmetic.
  return now.toLocaleDateString("en-CA", { timeZone: DISPLAY_TIME_ZONE });
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
