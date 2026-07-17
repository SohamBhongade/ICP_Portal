// Course normalization — the SINGLE SOURCE OF TRUTH for turning messy course
// input into the portal's official enum value.
//
// Pure module (no DB / server-only imports) so it is shared by BOTH the client
// CSV preview (live per-row flagging) and the server import/create actions
// (authoritative validation before any DB write). Keeping one implementation
// means the preview a user sees can never disagree with what the server accepts.

/**
 * Sanitize a raw course string: lowercase, then strip everything that isn't a
 * letter or digit (spaces, dots, hyphens, etc.).
 *   "b. pharm" | "B Pharm" | "B.Pharm." | "bpharm"  ->  "bpharm"
 */
export function sanitizeCourse(raw: string): string {
  return raw.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Master dictionary: sanitized key -> official portal enum value.
 * Add a new course by adding one line here; every layer picks it up.
 */
export const COURSE_ENUM_BY_KEY: Record<string, string> = {
  bpharm: "B.pharm",
  dpharm: "D.pharm",
  mpharm: "M.pharm",
};

/** All canonical course values the portal recognises. */
export const COURSE_ENUM_VALUES = Object.values(COURSE_ENUM_BY_KEY);

/**
 * Map a raw course string to its official enum value, or null when the
 * (non-empty) input matches no known course (e.g. "Bachelor of Pharmacy").
 */
export function mapCourseToEnum(raw: string): string | null {
  return COURSE_ENUM_BY_KEY[sanitizeCourse(raw)] ?? null;
}

export type CourseResolution =
  | { status: "empty" } // no course supplied — allowed (course is nullable)
  | { status: "ok"; value: string } // recognised -> canonical enum value
  | { status: "invalid"; input: string }; // supplied but unrecognisable

/**
 * Resolve an optional course cell into empty / ok / invalid. Callers treat
 * "empty" as a pass (no course assigned) and "invalid" as a row failure.
 */
export function resolveCourse(raw: string | null | undefined): CourseResolution {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { status: "empty" };
  const value = mapCourseToEnum(trimmed);
  return value ? { status: "ok", value } : { status: "invalid", input: trimmed };
}
