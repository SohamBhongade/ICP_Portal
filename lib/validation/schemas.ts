// One schema per server action payload.
//
// These describe the SHAPE of a payload: types, lengths, formats, enum
// membership, and — via z.strictObject — the complete set of permitted keys.
// They deliberately do NOT encode business rules (e.g. "staff must supply an
// email", "a course must resolve to a known programme"). Those live in the
// actions, unchanged, and still run after this layer. Validation is additive:
// nothing that used to be accepted by the business rules is rejected here.
//
// Why strict objects matter: a server action is a public endpoint. Without
// strict mode, a caller could append `{ role: "admin", status: "active" }` to
// any payload, and any future spread into a DB write would silently pick it up.
// Strict mode turns that into a rejected request instead of a latent hole.

import {
  LIMITS,
  attendanceStatusEnum,
  dbId,
  dropdownCategoryEnum,
  emailField,
  isoDate,
  ledgerTypeEnum,
  localeEnum,
  moneyAmount,
  optionalEmail,
  optionalText,
  requiredSafeText,
  requiredText,
  roleEnum,
  safeText,
  ticketCategoryEnum,
  ticketStatusEnum,
  userStatusEnum,
  z,
} from "./core";
import {
  USER_FIELD_LIMITS,
  USER_FIELD_TYPES,
} from "../user-fields";

/**
 * Accounts one bulk-delete call may address.
 *
 * Not a rate limit — that is RULES.bulkDeleteUsers — but a per-call ceiling, so
 * a single forged request can never enqueue an unbounded cascade. A registrar
 * clearing a graduated cohort works in filtered batches well under this.
 */
export const BULK_DELETE_MAX = 100;

// ---------------------------------------------------------------------------
// auth.ts
// ---------------------------------------------------------------------------

/** loginAction — fields pulled out of FormData before parsing. */
export const loginSchema = z.strictObject({
  mode: z.enum(["student", "staff"]),
  identifier: requiredText(LIMITS.identifier),
  // Only presence and a sane ceiling: complexity rules belong to registration,
  // and rejecting a "malformed" password at login would leak policy details.
  password: z.string().min(1).max(LIMITS.password),
  locale: localeEnum,
});

/** requestAccountAction — public, unauthenticated payload. */
export const requestAccountSchema = z.strictObject({
  role: roleEnum,
  fullName: requiredText(LIMITS.name),
  studentId: optionalText(LIMITS.shortText),
  email: optionalEmail,
  phone: optionalText(LIMITS.phone),
  course: optionalText(LIMITS.shortText),
  className: optionalText(LIMITS.shortText),
  practicalBatch: optionalText(LIMITS.shortText),
  employeeId: optionalText(LIMITS.shortText),
  department: optionalText(LIMITS.shortText),
  designation: optionalText(LIMITS.shortText),
});

// ---------------------------------------------------------------------------
// attendance.ts
// ---------------------------------------------------------------------------

export const rosterFilterSchema = z.strictObject({
  course: requiredText(LIMITS.shortText),
  className: requiredText(LIMITS.shortText),
  practicalBatch: optionalText(LIMITS.shortText),
});

export const submitAttendanceSchema = z.strictObject({
  date: isoDate,
  className: requiredText(LIMITS.shortText),
  subject: requiredText(LIMITS.shortText),
  practicalBatch: optionalText(LIMITS.shortText),
  records: z
    .array(
      z.strictObject({
        studentId: dbId,
        status: attendanceStatusEnum,
      }),
    )
    .min(1)
    .max(LIMITS.attendanceRecords),
});

// ---------------------------------------------------------------------------
// fees.ts
// ---------------------------------------------------------------------------

export const studentIdSchema = dbId;

export const postTransactionSchema = z.strictObject({
  studentId: dbId,
  type: ledgerTypeEnum,
  particulars: requiredText(LIMITS.particulars),
  amount: moneyAmount,
  receiptNo: optionalText(LIMITS.receiptNo),
  date: isoDate,
});

// ---------------------------------------------------------------------------
// onboarding.ts
// ---------------------------------------------------------------------------

export const createUserSchema = z.strictObject({
  role: roleEnum,
  fullName: requiredText(LIMITS.name),
  email: optionalEmail,
  phone: optionalText(LIMITS.phone),
  studentId: optionalText(LIMITS.shortText),
  course: optionalText(LIMITS.shortText),
  className: optionalText(LIMITS.shortText),
  practicalBatch: optionalText(LIMITS.shortText),
});

// NOTE: the CSV row-array schema that used to live here was removed in Phase 4
// along with bulkImportStudentsAction. The import no longer accepts rows from
// the client at all — it accepts the FILE and parses it server-side, where the
// size / type / row / cell limits are enforced. See lib/import/parse.ts.

export const approveRequestSchema = z.strictObject({
  id: dbId,
  role: roleEnum,
  fullName: requiredText(LIMITS.name),
  studentId: optionalText(LIMITS.shortText),
  email: optionalEmail,
  phone: optionalText(LIMITS.phone),
  course: optionalText(LIMITS.shortText),
  className: optionalText(LIMITS.shortText),
  practicalBatch: optionalText(LIMITS.shortText),
  employeeId: optionalText(LIMITS.shortText),
  department: optionalText(LIMITS.shortText),
  designation: optionalText(LIMITS.shortText),
  password: optionalText(LIMITS.password),
});

export const updateUserSchema = z.strictObject({
  id: dbId,
  fullName: requiredText(LIMITS.name),
  email: optionalEmail,
  phone: optionalText(LIMITS.phone),
  studentId: optionalText(LIMITS.shortText),
  course: optionalText(LIMITS.shortText),
  className: optionalText(LIMITS.shortText),
  practicalBatch: optionalText(LIMITS.shortText),
  // Calendar year of admission (students). null clears it; omitted leaves it.
  admissionYear: z.number().int().min(1950).max(2100).nullable().optional(),
  status: userStatusEnum,
});

export const idSchema = dbId;

/**
 * bulkDeleteUsersAction — the id list.
 *
 * Bounded at BULK_DELETE_MAX so one call can never be handed an unbounded array
 * (the action would otherwise loop over it before any per-user check runs), and
 * deduped so a payload repeating the same id 100 times counts as one account
 * against the cap.
 */
export const bulkDeleteUsersSchema = z
  .array(dbId)
  .min(1)
  .max(BULK_DELETE_MAX)
  .transform((ids) => Array.from(new Set(ids)));

/**
 * Accounts one bulk FIELD EDIT may address.
 *
 * Higher than BULK_DELETE_MAX because a field edit is reversible (re-run it
 * with the old value) whereas a delete is not, and because reassigning a whole
 * cohort's class is a normal registrar task. Still bounded: the action resolves
 * every id before writing, so an unbounded array would be an unbounded read.
 */
export const BULK_UPDATE_MAX = 500;

/**
 * bulkUpdateUsersAction — the id list plus ONE field change.
 *
 * A discriminated union rather than a partial user object, deliberately: this
 * endpoint may only ever set the single field the operator picked in the UI. A
 * free-form patch would let a forged payload sweep `status` or `role` across
 * hundreds of accounts in one call, which is precisely the blast radius a bulk
 * endpoint must not have.
 *
 * `value` is the RAW text the operator typed or picked; the action coerces and
 * validates it (course normalization, year parsing, custom-column type check).
 * An empty string means "clear this field".
 */
export const bulkUpdateUsersSchema = z.strictObject({
  ids: z
    .array(dbId)
    .min(1)
    .max(BULK_UPDATE_MAX)
    .transform((ids) => Array.from(new Set(ids))),
  change: z.discriminatedUnion("field", [
    z.strictObject({
      field: z.literal("className"),
      value: safeText(LIMITS.shortText),
    }),
    z.strictObject({
      field: z.literal("course"),
      value: safeText(LIMITS.shortText),
    }),
    z.strictObject({
      field: z.literal("admissionYear"),
      value: safeText(LIMITS.shortText),
    }),
    z.strictObject({
      field: z.literal("custom"),
      /** Which admin-defined column. Re-resolved server-side against user_fields. */
      fieldId: dbId,
      value: safeText(USER_FIELD_LIMITS.maxValue),
    }),
  ]),
});

// ---------------------------------------------------------------------------
// user-fields.ts — admin-defined columns on the Users grid
// ---------------------------------------------------------------------------

/** createUserFieldAction. The KEY is derived server-side from the label and is
 *  deliberately NOT part of this payload — a caller must not choose it. */
export const createUserFieldSchema = z.strictObject({
  label: requiredSafeText(USER_FIELD_LIMITS.maxLabel),
  type: z.enum(USER_FIELD_TYPES),
  options: z
    .array(requiredSafeText(USER_FIELD_LIMITS.maxOptionLength))
    .max(USER_FIELD_LIMITS.maxOptions)
    .optional(),
});

/** renameUserFieldAction — label only. The key is immutable by design. */
export const renameUserFieldSchema = z.strictObject({
  id: dbId,
  label: requiredSafeText(USER_FIELD_LIMITS.maxLabel),
});

/** setUserFieldValueAction — one cell. */
export const setUserFieldValueSchema = z.strictObject({
  userId: dbId,
  fieldId: dbId,
  value: safeText(USER_FIELD_LIMITS.maxValue),
});

// ---------------------------------------------------------------------------
// preferences.ts
// ---------------------------------------------------------------------------
//
// The column keys themselves are re-checked against the canonical whitelist by
// sanitizeUsersTableLayout(); this bounds the array before it gets there.
export const usersTableLayoutSchema = z
  .array(
    z.strictObject({
      key: z.string().min(1).max(64),
      visible: z.boolean(),
    }),
  )
  .max(64);

// ---------------------------------------------------------------------------
// edit-mode.ts — the highest-risk surface (see core.ts `safeText`)
// ---------------------------------------------------------------------------

export const setEditModeSchema = z.boolean();

export const textOverrideSchema = z.strictObject({
  locale: localeEnum,
  // A dot-path into the dictionary. Constrained to identifier characters so it
  // can only ever address a translation key.
  key: z
    .string()
    .trim()
    .min(1)
    .max(LIMITS.overrideKey)
    .regex(
      /^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/,
      "Not a valid translation key",
    ),
  // Empty string is meaningful: it clears the override. Anything non-empty must
  // be markup-free.
  value: safeText(LIMITS.overrideValue),
});

export const addDropdownOptionSchema = z.strictObject({
  category: dropdownCategoryEnum,
  // Stored value + displayed label are both rendered back to every user, so
  // both go through the markup-rejecting text type.
  value: safeText(LIMITS.shortText).refine(
    (v) => v.length > 0,
    "A value is required",
  ),
  label: safeText(LIMITS.shortText),
});

// ---------------------------------------------------------------------------
// support.ts
// ---------------------------------------------------------------------------

export const createTicketSchema = z.strictObject({
  category: ticketCategoryEnum,
  subject: optionalText(LIMITS.ticketSubject),
  message: requiredText(LIMITS.ticketMessage),
});

export const updateTicketSchema = z.strictObject({
  id: dbId,
  status: ticketStatusEnum,
  response: optionalText(LIMITS.ticketResponse),
});

// Re-export so actions import their schema and the email helper from one place.
export { emailField };
