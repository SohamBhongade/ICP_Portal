// Shared input-validation primitives.
//
// Every server action validates its payload here, on the SERVER, at the entry
// point. Client-side checks (required attributes, live form feedback) stay for
// UX and are never trusted — a server action is a public HTTP endpoint that any
// client can call with any JSON body.
//
// Design rules baked into this module:
//   1. STRICT objects everywhere. Unknown keys are rejected, not stripped and
//      not passed through, so a payload can never smuggle an extra field into a
//      DB write (e.g. `role`, `status`, `passwordHash`).
//   2. Every string is length-bounded. Unbounded text is a denial-of-service and
//      a storage problem long before it is a correctness one.
//   3. Errors come back as STRUCTURED, per-field messages the UI can render.
//      They describe the caller's own input only — never a stack trace, SQL
//      string, column name, or any other server internal.
//
// NOTE on Zod version: this project is on Zod 4, where `z.strictObject({...})`
// is the current spelling of `z.object({...}).strict()`. Same semantics —
// unknown keys produce an `unrecognized_keys` issue.

import { z } from "zod";

// ---------------------------------------------------------------------------
// Length ceilings. Generous enough for real data, tight enough to bound writes.
// ---------------------------------------------------------------------------
export const LIMITS = {
  name: 120,
  identifier: 255, // login identifier: roll number or email
  password: 200, // bcrypt truncates at 72 bytes; the cap is anti-DoS
  email: 254, // RFC 5321 maximum
  phone: 32,
  shortText: 120, // course, class, batch, department, designation, subject…
  ticketSubject: 200,
  ticketMessage: 5000,
  ticketResponse: 5000,
  particulars: 300,
  receiptNo: 60,
  overrideKey: 200,
  overrideValue: 2000,
  csvRows: 2000, // one import batch
  attendanceRecords: 1000, // one class session
} as const;

// ---------------------------------------------------------------------------
// Primitives
// ---------------------------------------------------------------------------

/** A database row id: a positive, safe integer. */
export const dbId = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * Trimmed, non-empty, length-bounded text. `.trim()` runs before the length
 * check, so "   " is empty rather than 3 characters.
 */
export const requiredText = (max: number) => z.string().trim().min(1).max(max);

/**
 * Trimmed optional text. Accepts undefined, null, or "" — all normalized to
 * undefined so downstream `|| undefined` logic keeps behaving as it does today.
 */
export const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : undefined));

// Mirrors the EMAIL_RE used across the actions, kept identical so validation
// never rejects something the existing business checks would have accepted.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Lowercased, trimmed, shape-checked email. */
export const emailField = z
  .string()
  .trim()
  .max(LIMITS.email)
  .regex(EMAIL_RE, "Enter a valid email address")
  .transform((v) => v.toLowerCase());

/** Optional email — "" and null become undefined rather than failing. */
export const optionalEmail = z
  .union([z.literal(""), z.null(), z.undefined(), emailField])
  .transform((v) => (v ? v : undefined));

/** Strict 'YYYY-MM-DD'. Also rejects impossible dates like 2026-02-31. */
export const isoDate = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD")
  .refine((v) => {
    const [y, m, d] = v.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    return (
      dt.getUTCFullYear() === y &&
      dt.getUTCMonth() === m - 1 &&
      dt.getUTCDate() === d
    );
  }, "That date does not exist");

/** A money amount: finite, positive, at most 2 decimal places, bounded. */
export const moneyAmount = z
  .number()
  .finite()
  .positive()
  .max(10_000_000)
  .refine((v) => Math.round(v * 100) === Number((v * 100).toFixed(0)), {
    message: "Use at most two decimal places",
  });

// ---------------------------------------------------------------------------
// Markup-rejecting text — the Edit Mode surface
// ---------------------------------------------------------------------------
//
// text_overrides stores admin-authored strings that are rendered app-wide, so it
// is the highest-value injection target in the app. It is defended in DEPTH:
//
//   Primary defence (already in place, and the one that actually matters):
//     every override is rendered as a JSX text child — `<span>{current}</span>`
//     in components/edit-mode/Editable.tsx and `{t("…")}` everywhere else.
//     React escapes text children, so "<script>x</script>" renders as visible
//     characters, not as an element. There is no dangerouslySetInnerHTML
//     anywhere in this codebase (audited), so there is no sink to reach.
//
//   Secondary defence (added here): refuse to STORE anything tag-shaped or
//     protocol-shaped in the first place. If a future change ever introduces an
//     HTML sink, the stored data is already inert.
//
// The pattern is deliberately narrow so ordinary prose still works: "Fees > 5000"
// and "A < B" are fine, because a bare comparison operator is not followed by a
// tag-name character. Only `<` immediately followed by a letter, `/`, `!` or `?`
// is treated as markup.
const TAG_LIKE = /<[a-zA-Z/!?]/;
const DANGEROUS_PROTOCOL = /\b(?:javascript|vbscript|data)\s*:/i;
const HTML_ENTITY_TAG = /&(?:#x?0*(?:60|3c)|lt);/i; // encoded "<"
// C0/C1 control characters, except tab, newline and carriage return, which are
// legitimate inside multi-line text. Written as escapes so this source file
// never itself contains a literal control byte (which also means the
// no-control-regex lint rule has nothing to complain about).
const CONTROL_CHARS =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

/**
 * Text that is safe to store and re-render. Rejects markup, script/data URIs,
 * encoded tag openers, and control characters. Used for every admin-authored
 * string that is displayed back to other users.
 */
export const safeText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => !TAG_LIKE.test(v), "HTML tags are not allowed")
    .refine((v) => !HTML_ENTITY_TAG.test(v), "Encoded HTML is not allowed")
    .refine(
      (v) => !DANGEROUS_PROTOCOL.test(v),
      "javascript:, vbscript: and data: URIs are not allowed",
    )
    .refine((v) => !CONTROL_CHARS.test(v), "Control characters are not allowed");

/** Required (non-empty) markup-free text. */
export const requiredSafeText = (max: number) =>
  safeText(max).refine((v) => v.length > 0, "This field is required");

// ---------------------------------------------------------------------------
// Enums — kept in sync with db/schema.ts and lib/auth/permissions.ts
// ---------------------------------------------------------------------------
export const roleEnum = z.enum([
  "admin",
  "office admin",
  "principal",
  "staff",
  "faculty",
  "student",
]);
export const userStatusEnum = z.enum(["pending", "active", "rejected"]);
export const attendanceStatusEnum = z.enum(["present", "absent", "late"]);
export const ledgerTypeEnum = z.enum(["charge", "payment"]);
export const ticketCategoryEnum = z.enum([
  "fee",
  "attendance",
  "technical",
  "academic",
  "administrative",
]);
export const ticketStatusEnum = z.enum([
  "open",
  "in_progress",
  "resolved",
  "closed",
]);
export const dropdownCategoryEnum = z.enum([
  "course",
  "semester",
  "subject",
  "class",
  "practical_batch",
]);
export const localeEnum = z.enum(["en"]);

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

/** Field path -> first message for that field. `_form` holds top-level issues. */
export type FieldErrors = Record<string, string>;

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; fieldErrors: FieldErrors };

/**
 * Turn Zod issues into a flat { field: message } map the UI can render beside
 * inputs. Only the FIRST issue per field is kept — showing five messages under
 * one box helps nobody.
 *
 * Every message here is derived from the caller's own input. Nothing about the
 * server (schema internals, column names, driver text) is included.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    // Array indices are folded into the parent key ("records.0.status"), which
    // is what a client needs to point at the offending row.
    const key = issue.path.length ? issue.path.join(".") : "_form";
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/**
 * Validate an untrusted payload against a schema.
 *
 * Call this at the TOP of a server action, after the authorization gate and
 * before any business DB call, then use `result.data` — never the raw input —
 * for everything downstream, so the parsed/trimmed/normalized values are what
 * actually reach the database.
 */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ParseResult<z.infer<S>> {
  const result = schema.safeParse(input);
  if (result.success) return { ok: true, data: result.data };
  return { ok: false, fieldErrors: toFieldErrors(result.error) };
}

export { z };
