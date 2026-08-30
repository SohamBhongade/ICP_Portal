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
  requiredText,
  roleEnum,
  safeText,
  ticketCategoryEnum,
  ticketStatusEnum,
  userStatusEnum,
  z,
} from "./core";

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
  status: userStatusEnum,
});

export const idSchema = dbId;

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
