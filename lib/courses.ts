// Course normalization — the SINGLE SOURCE OF TRUTH for turning messy course
// input into the portal's official value, plus pulling the academic year out of
// the same free-text cell.
//
// Pure module (no DB / server-only imports) so it is shared by BOTH the client
// CSV preview (live per-row flagging) and the server import/create actions
// (authoritative validation before any DB write). Keeping one implementation
// means the preview a user sees can never disagree with what the server accepts.
//
// DESIGN: this is a *pattern-matching* normalizer, not a static lookup table, so
// new courses ("M.Pharm", "M Pharm", "1st year B.Pharm", or future programmes)
// normalize correctly with NO code change:
//   1. extractYear()            — pull "1st year" / "second yr" / "2nd" → 1..4
//   2. standardizeCourseToken() — collapse punctuation, then apply the dynamic
//                                 "*pharm" formula, else a clean acronym fallback
//   3. normalizeCourse()        — run both over one raw cell → { year, course }

/**
 * Sanitize a raw course string: lowercase, then strip everything that isn't a
 * letter or digit (spaces, dots, hyphens, etc.).
 *   "b. pharm" | "B Pharm" | "B.Pharm." | "bpharm"  ->  "bpharm"
 */
export function sanitizeCourse(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Canonical pharm values the formula reproduces (kept for reference / callers
// that want the known set; the formula below is authoritative and open-ended).
export const COURSE_ENUM_BY_KEY: Record<string, string> = {
  bpharm: "B.pharm",
  dpharm: "D.pharm",
  mpharm: "M.pharm",
};

/** All canonical pharm course values the portal ships with. */
export const COURSE_ENUM_VALUES = Object.values(COURSE_ENUM_BY_KEY);

// Written ordinals → integer. Digits ("1st", "2") are parsed directly.
const YEAR_WORDS: Record<string, number> = {
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
};

// Year patterns, tried in priority order. Each captures the year number and the
// full matched span (removed from the string so only the course text remains).
// Supports years 1–4 to stay future-proof (B.Pharm runs four years) even though
// most inputs are 1 or 2.
const YEAR_PATTERNS: RegExp[] = [
  // "1st year", "2 nd yr", "3rd", "1styear" — a digit + ordinal suffix, year word optional
  /\b([1-4])(?:st|nd|rd|th)\s*(?:years?|yrs?)?\b/i,
  // "year 1", "yr 2"
  /\b(?:years?|yrs?)\s*([1-4])\b/i,
  // "first year", "second yr", "third" — a written ordinal, year word optional
  /\b(first|second|third|fourth)\s*(?:years?|yrs?)?\b/i,
  // "1 year", "2 yr" — a plain digit that is explicitly qualified by a year word
  /\b([1-4])\s*(?:years?|yrs?)\b/i,
];

/**
 * Pull an academic year (1–4) out of a free-text course/class cell and return
 * the year plus the remaining text with that year phrase removed.
 *   "1st year B.Pharm"  -> { year: 1, rest: "B.Pharm" }
 *   "B.Pharm 2nd yr"    -> { year: 2, rest: "B.Pharm" }
 *   "second year"       -> { year: 2, rest: "" }
 *   "M.Pharm"           -> { year: null, rest: "M.Pharm" }
 */
export function extractYear(raw: string | null | undefined): {
  year: number | null;
  rest: string;
} {
  const text = (raw ?? "").trim();
  if (!text) return { year: null, rest: "" };

  for (const re of YEAR_PATTERNS) {
    const m = text.match(re);
    if (!m || m.index === undefined) continue;
    const token = m[1].toLowerCase();
    const year = YEAR_WORDS[token] ?? Number(token);
    if (!Number.isFinite(year)) continue;
    // Excise the matched year phrase; leave a space so words don't fuse.
    const rest = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length))
      .replace(/\s+/g, " ")
      .trim();
    return { year, rest };
  }
  return { year: null, rest: text };
}

/**
 * Standardize a course token (year already stripped) into its canonical form,
 * or null when there is no real course text left.
 *
 * Formula (no per-course code needed):
 *   - collapse to lowercase alphanumerics ("M. Pharm" | "m pharm" -> "mpharm")
 *   - anything ending in "pharm" → capitalize the leading segment + ".pharm"
 *       "bpharm" -> "B.pharm", "dpharm" -> "D.pharm", "mpharm" -> "M.pharm"
 *   - otherwise fall back to a clean uppercase acronym
 *       "bca" | "B.C.A" -> "BCA"
 */
export function standardizeCourseToken(raw: string | null | undefined): string | null {
  const collapsed = sanitizeCourse(raw ?? "");
  // Need at least one letter — pure punctuation/digits isn't a course.
  if (!collapsed || !/[a-z]/.test(collapsed)) return null;

  if (collapsed.endsWith("pharm")) {
    const base = collapsed.slice(0, -"pharm".length);
    if (!base) return "Pharm";
    return base.charAt(0).toUpperCase() + base.slice(1).toLowerCase() + ".pharm";
  }

  // Non-pharm programmes: uppercase acronym (spaces/dots already removed).
  return collapsed.toUpperCase();
}

export type NormalizedCourse = {
  year: number | null; // extracted academic year, or null when absent
  course: string | null; // canonical course value, or null when no course text
};

/**
 * Normalize one raw course cell into its academic year + canonical course.
 * Idempotent: feeding a value already produced here returns it unchanged.
 */
export function normalizeCourse(raw: string | null | undefined): NormalizedCourse {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { year: null, course: null };
  const { year, rest } = extractYear(trimmed);
  return { year, course: standardizeCourseToken(rest) };
}

export type CourseResolution =
  | { status: "empty" } // no course supplied — allowed (course is nullable)
  | { status: "ok"; value: string } // recognised -> canonical value
  | { status: "invalid"; input: string }; // supplied but nothing course-like

/**
 * Resolve an optional course cell into empty / ok / invalid. Callers treat
 * "empty" as a pass (no course assigned) and "invalid" as a row failure.
 *
 * With the dynamic formula, any input containing course-like letters resolves to
 * "ok" (that's the point — new programmes shouldn't fail). "invalid" now only
 * fires for junk that is non-empty yet has no course text at all (e.g. "123",
 * "--"); a year-only cell like "1st year" resolves to "empty".
 */
export function resolveCourse(raw: string | null | undefined): CourseResolution {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { status: "empty" };
  const { year, course } = normalizeCourse(trimmed);
  if (course) return { status: "ok", value: course };
  return year != null ? { status: "empty" } : { status: "invalid", input: trimmed };
}

/**
 * Convenience for callers that map a raw cell straight to its canonical value
 * (or null when unrecognisable / empty).
 */
export function mapCourseToEnum(raw: string): string | null {
  return normalizeCourse(raw).course;
}
