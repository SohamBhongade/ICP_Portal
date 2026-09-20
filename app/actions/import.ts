"use server";

// Student roster import — SERVER-SIDE parsing.
//
// Replaces the previous flow, in which the browser parsed the CSV with
// papaparse and posted an array of rows. That payload was attacker-controlled:
// anyone could call the action directly with 100 000 rows of anything and the
// server had no idea what the uploaded file actually said. Now the FILE is
// uploaded and the server is the only thing that ever parses it.
//
// Two entry points, both admin-only (`createUsers`) and both re-parsing from
// scratch:
//
//   parseImportFileAction   — preview. Returns headers + sanitized rows so the
//                             operator can map columns and review what will be
//                             created. Writes nothing.
//   importStudentsFileAction — the authoritative import. Takes the SAME file
//                             plus the chosen column mapping, re-parses it
//                             server-side, and inserts. It never trusts the
//                             rows the preview returned, because those made a
//                             round trip through the client.
//
// Re-parsing on import is deliberate. The alternative — trusting the preview's
// rows on the second call — would reopen exactly the hole this replaces. The
// file is re-uploaded transparently from the browser's existing File object, so
// the operator does not pick it twice.

import bcrypt from "bcryptjs";
import { and, eq, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { feeLedgers, userFieldValues, users } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { can, type Role } from "@/lib/auth/permissions";
import { todayIso } from "@/lib/dates";
import type { FeeCategory } from "@/lib/fees";
import {
  buildFeeLines,
  feeCategoryForTarget,
  feeLineParticulars,
  feeTargetKey,
  type FeeImportOptions,
  type FeeLine,
} from "@/lib/import/fee-columns";
import { extractYear, normalizeCourse, resolveCourse } from "@/lib/courses";
import { logServerError } from "@/lib/errors";
import { RULES, checkRateLimit } from "@/lib/rate-limit";
import {
  IMPORT_LIMITS,
  parseImportFile,
  type ImportRejection,
  type ParsedSheet,
} from "@/lib/import/parse";
import { z, parseInput, LIMITS, isoDate } from "@/lib/validation/core";
import {
  customColumnKey,
  validateFieldValue,
  type CustomField,
} from "@/lib/user-fields";
import { listUserFields } from "@/lib/user-fields-query";

/** Built-in fields a roster column can be mapped onto. Mirrors the client's FIELDS. */
const TARGET_FIELDS = [
  "fullName",
  "studentId",
  "email",
  "phone",
  "course",
  "className",
  "practicalBatch",
] as const;
export type BuiltInTargetField = (typeof TARGET_FIELDS)[number];

/**
 * A mapping target: a built-in field, or `custom:<field key>` for an
 * admin-defined column (Phase 9). Custom targets are validated against the LIVE
 * `user_fields` list loaded on the server — the mapping arrives from the
 * browser, so a `custom:` key it names is a claim, not a fact.
 */
export type TargetField = BuiltInTargetField | (string & {});

const BUILT_IN_TARGETS = new Set<string>(TARGET_FIELDS);

/**
 * Chosen mapping: target field -> source column header.
 *
 * A record rather than a strict object, because the permitted key set is no
 * longer static. Both sides are bounded here (key length, value length, total
 * entries) and the keys themselves are whitelisted in `resolveMapping` below
 * against the built-ins plus the custom columns that actually exist.
 */
const mappingSchema = z
  .record(
    z.string().trim().min(1).max(LIMITS.shortText),
    z.string().trim().min(1).max(LIMITS.shortText),
  )
  .refine((m) => Object.keys(m).length <= 128, "Too many mapped columns");

export type ImportMapping = Partial<Record<TargetField, string>>;

/**
 * Reject any mapping key that is neither a built-in field nor a live custom
 * column. Returns the filtered mapping plus the custom fields it references, so
 * the insert loop can validate each value against its declared type.
 */
function resolveMapping(
  raw: Record<string, string>,
  fields: CustomField[],
): {
  mapping: ImportMapping;
  customTargets: CustomField[];
  feeTargets: FeeCategory[];
} {
  const byColumnKey = new Map(fields.map((f) => [customColumnKey(f.key), f]));
  const mapping: ImportMapping = {};
  const customTargets: CustomField[] = [];
  const feeTargets: FeeCategory[] = [];

  for (const [target, header] of Object.entries(raw)) {
    if (BUILT_IN_TARGETS.has(target)) {
      mapping[target as BuiltInTargetField] = header;
      continue;
    }
    const field = byColumnKey.get(target);
    if (field) {
      mapping[target] = header;
      customTargets.push(field);
      continue;
    }
    // `fee:<category value>` — whitelisted against the fixed FEE_CATEGORIES
    // list, so a forged key cannot invent a ledger category.
    const category = feeCategoryForTarget(target);
    if (category) {
      mapping[target] = header;
      feeTargets.push(category);
    }
    // Anything else is silently dropped: an unknown target is a stale or forged
    // key, and refusing the whole import over one would strand the operator.
  }
  return { mapping, customTargets, feeTargets };
}

/**
 * Options for posting mapped fee columns to the ledger. Sent as JSON beside
 * the mapping and validated here — every field is operator-controlled input.
 */
const feeOptionsSchema = z.strictObject({
  /** Ledger date for every entry this import posts. */
  date: isoDate,
  /** Optional note appended to particulars, e.g. "AY 2024-25". */
  note: z.string().trim().max(LIMITS.shortText).default(""),
  scholarshipOnTop: z.boolean().default(true),
  /**
   * Post fees to students who ALREADY exist (matched by roll number AND name)
   * instead of reporting them as duplicates. Off by default.
   */
  updateExisting: z.boolean().default(false),
});
type FeeOptions = z.infer<typeof feeOptionsSchema>;

export type ImportError =
  | "forbidden"
  | "feesForbidden"
  | "rateLimited"
  | "missingFile"
  | "badMapping"
  | "badFeeOptions"
  | ImportRejection;

export type PreviewResult =
  | {
      ok: true;
      headers: string[];
      rows: Record<string, string>[];
      /** Live custom columns, offered as additional mapping targets. */
      customFields: CustomField[];
      /** Whether this operator may post fee columns to the ledger (feeWrites). */
      canPostFees: boolean;
      /** Institution-local today, to pre-fill the ledger date. */
      today: string;
      limits: { maxRows: number; maxCellLength: number; maxFileBytes: number };
    }
  | { ok: false; error: ImportError; retryAfter?: number };

export type RowFailure = {
  row: number;
  reason:
    | "missingName"
    | "missingRollNo"
    | "invalidEmail"
    | "invalidCourse"
    | "invalidFee"
    | "duplicate"
    | "nameMismatch"
    | "unknown";
  /** For invalidFee: the stored value of the category whose cell was bad. */
  detail?: string;
};

export type ImportResult =
  | {
      ok: true;
      created: number;
      /** Existing students who received fee entries (updateExisting only). */
      updated: number;
      /** Ledger rows written, across new and existing students. */
      feeEntries: number;
      /** Existing students skipped because this exact entry was already posted. */
      alreadyPosted: number;
      failed: RowFailure[];
    }
  | { ok: false; error: ImportError; retryAfter?: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 12;

/** Admin-only gate, identical to the one on every other creation path. */
async function assertCreateUsers() {
  return currentUserWithCapability("createUsers");
}

/** Pull the single upload out of the form, or null. */
function fileFrom(formData: FormData): File | null {
  const value = formData.get("file");
  return value instanceof File && value.size >= 0 ? value : null;
}

/**
 * Step 1 — parse for preview. Rejects the file on size, type, row count, column
 * count, or cell length before returning anything, so the operator sees the
 * real reason rather than a truncated preview.
 */
export async function parseImportFileAction(
  formData: FormData,
): Promise<PreviewResult> {
  const actor = await assertCreateUsers();
  if (!actor) return { ok: false, error: "forbidden" };

  // Parsing a spreadsheet is the most expensive thing an admin can ask for, so
  // it is throttled per user in addition to the per-IP limit in proxy.ts.
  const limit = await checkRateLimit(RULES.importUser, String(actor.id));
  if (!limit.allowed) {
    return { ok: false, error: "rateLimited", retryAfter: limit.retryAfter };
  }

  const file = fileFrom(formData);
  if (!file) return { ok: false, error: "missingFile" };

  const parsed = await parseImportFile(file);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  return {
    ok: true,
    headers: parsed.sheet.headers,
    rows: parsed.sheet.rows,
    // Sent with the preview so the mapping UI can offer custom columns without
    // a second round trip. Authoritative either way: the import re-loads them.
    customFields: await listUserFields(),
    canPostFees: can(actor.role as Role, "feeWrites"),
    today: todayIso(),
    limits: {
      maxRows: IMPORT_LIMITS.maxRows,
      maxCellLength: IMPORT_LIMITS.maxCellLength,
      maxFileBytes: IMPORT_LIMITS.maxFileBytes,
    },
  };
}

/**
 * Apply the operator's column mapping to one sanitized sheet row.
 *
 * Returns the built-in fields under their own names and every mapped custom
 * column under its `custom:<key>` target, so the insert loop can split them
 * without re-consulting the mapping.
 */
function applyMapping(
  row: Record<string, string>,
  mapping: ImportMapping,
): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const target of Object.keys(mapping)) {
    const header = mapping[target];
    out[target] = header ? (row[header] ?? "") || undefined : undefined;
  }
  // Built-ins are always present as keys (possibly undefined) so the checks
  // below read the same whether or not the operator mapped them.
  for (const field of TARGET_FIELDS) {
    if (!(field in out)) out[field] = undefined;
  }
  return out;
}

/**
 * Step 2 — the authoritative import. Re-parses the uploaded file server-side,
 * applies the mapping, then inserts row by row so one bad row never sinks the
 * batch (failures come back with 1-based row numbers, as before).
 */
export async function importStudentsFileAction(
  formData: FormData,
): Promise<ImportResult> {
  const actor = await assertCreateUsers();
  if (!actor) return { ok: false, error: "forbidden" };

  const limit = await checkRateLimit(RULES.importUser, String(actor.id));
  if (!limit.allowed) {
    return { ok: false, error: "rateLimited", retryAfter: limit.retryAfter };
  }

  const file = fileFrom(formData);
  if (!file) return { ok: false, error: "missingFile" };

  // The mapping arrives as JSON in the same multipart body.
  let rawMapping: unknown;
  try {
    rawMapping = JSON.parse(String(formData.get("mapping") ?? "{}"));
  } catch {
    return { ok: false, error: "badMapping" };
  }
  const mappingParsed = parseInput(mappingSchema, rawMapping);
  if (!mappingParsed.ok) return { ok: false, error: "badMapping" };

  // WHITELIST THE TARGETS. The custom-column list is re-loaded from the DB here,
  // not carried over from the preview — a `custom:` key the browser sent is a
  // claim about what columns exist, and only the database gets to answer that.
  const fields = await listUserFields();
  const { mapping, customTargets, feeTargets } = resolveMapping(
    mappingParsed.data as Record<string, string>,
    fields,
  );

  // FEE COLUMNS. Posting to the ledger is a separate capability from creating
  // accounts, so it is checked separately — holding `createUsers` alone must
  // not be a back door into fee writes.
  let feeOptions: FeeOptions | null = null;
  if (feeTargets.length > 0) {
    if (!can(actor.role as Role, "feeWrites")) {
      return { ok: false, error: "feesForbidden" };
    }
    let rawOptions: unknown;
    try {
      rawOptions = JSON.parse(String(formData.get("feeOptions") ?? "{}"));
    } catch {
      return { ok: false, error: "badFeeOptions" };
    }
    const optionsParsed = parseInput(feeOptionsSchema, rawOptions);
    if (!optionsParsed.ok) return { ok: false, error: "badFeeOptions" };
    feeOptions = optionsParsed.data;
  }

  // RE-PARSE. The preview's rows went through the client and are not trusted.
  const parsed = await parseImportFile(file);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  return insertRows(
    parsed.sheet,
    mapping,
    customTargets,
    feeTargets,
    feeOptions,
    actor.id,
  );
}

/** Pull the mapped fee cells out of a mapped row, keyed by category value. */
function feeCellsOf(
  row: Record<string, string | undefined>,
  feeTargets: FeeCategory[],
): Record<string, string | undefined> {
  const cells: Record<string, string | undefined> = {};
  for (const category of feeTargets) {
    cells[category.value] = row[feeTargetKey(category.value)];
  }
  return cells;
}

/** Name comparison that ignores case, spacing and punctuation. */
const sameName = (a: string, b: string) =>
  a.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "") ===
  b.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/**
 * fee_ledgers rows for a set of lines. `studentId` is either a real id or a SQL
 * subquery that resolves it inside the same batch (new accounts).
 */
function ledgerValues(
  studentId: number | SQL,
  lines: FeeLine[],
  options: FeeOptions,
  actorId: number,
) {
  return lines.map((line) => ({
    studentId,
    particulars: feeLineParticulars(line, options.note),
    type: line.type,
    amount: line.amount,
    receiptNo: null,
    date: options.date,
    recordedBy: actorId,
  }));
}

/**
 * Shared insert loop. Business rules for the built-in fields are unchanged.
 *
 * Custom column values are written AFTER the user row, keyed by the id the
 * insert returned. A value that fails its column's type check is skipped and
 * the row is still counted as created — a malformed "Guardian phone" must not
 * cost the student their account, and the operator sees the column blank.
 */
async function insertRows(
  sheet: ParsedSheet,
  mapping: ImportMapping,
  customTargets: CustomField[],
  feeTargets: FeeCategory[],
  feeOptions: FeeOptions | null,
  actorId: number,
): Promise<ImportResult> {
  let created = 0;
  let updated = 0;
  let feeEntries = 0;
  let alreadyPosted = 0;
  const failed: RowFailure[] = [];
  const buildOptions: FeeImportOptions = {
    scholarshipOnTop: feeOptions?.scholarshipOnTop ?? true,
  };

  for (let i = 0; i < sheet.rows.length; i++) {
    const r = applyMapping(sheet.rows[i], mapping);
    const rowNo = i + 1; // 1-based, for human-readable reporting

    const fullName = r.fullName?.trim() ?? "";
    const studentId = r.studentId?.trim() ?? "";
    const email = r.email?.trim().toLowerCase() || undefined;

    if (!fullName) {
      failed.push({ row: rowNo, reason: "missingName" });
      continue;
    }
    if (!studentId) {
      failed.push({ row: rowNo, reason: "missingRollNo" });
      continue;
    }
    if (email && !EMAIL_RE.test(email)) {
      failed.push({ row: rowNo, reason: "invalidEmail" });
      continue;
    }

    // Canonical course + academic year, exactly as the manual create path does.
    if (resolveCourse(r.course).status === "invalid") {
      failed.push({ row: rowNo, reason: "invalidCourse" });
      continue;
    }
    const norm = normalizeCourse(r.course);
    const year = norm.year ?? extractYear(r.className ?? "").year ?? undefined;

    // Fee cells are validated BEFORE anything is written, so a typo like
    // "45,45S" fails the row cleanly instead of creating a student whose
    // ledger silently lacks that charge.
    let feeLines: FeeLine[] = [];
    if (feeOptions && feeTargets.length > 0) {
      const fees = buildFeeLines(feeCellsOf(r, feeTargets), buildOptions);
      if (!fees.ok) {
        failed.push({
          row: rowNo,
          reason: "invalidFee",
          detail: fees.category.value,
        });
        continue;
      }
      feeLines = fees.lines;
    }

    try {
      const passwordHash = await bcrypt.hash(`Icp@${studentId}`, BCRYPT_COST);
      const userValues = {
        fullName,
        studentId,
        email,
        phone: r.phone?.trim() || undefined,
        role: "student" as const,
        status: "active" as const,
        course: norm.course ?? undefined,
        year,
        className: r.className?.trim() || undefined,
        practicalBatch: r.practicalBatch?.trim() || undefined,
        passwordHash,
      };

      if (feeLines.length === 0 || !feeOptions) {
        // No fees for this row — the original path, unchanged.
        const res = await db
          .insert(users)
          .values(userValues)
          .onConflictDoNothing()
          .returning({ id: users.id });

        if (res.length === 0) {
          failed.push({ row: rowNo, reason: "duplicate" });
        } else {
          created++;
          await writeCustomValues(res[0].id, r, customTargets);
        }
        continue;
      }

      // ACCOUNT + FEES AS ONE db.batch() — an implicit transaction on libSQL —
      // so a student is never created without the fees the sheet gave them.
      // The fee rows find the new account by roll number in a subquery, since
      // its id does not exist until the batch runs. The user insert has NO
      // onConflictDoNothing here on purpose: on a duplicate it must THROW and
      // roll the batch back, otherwise the subquery would resolve to the
      // EXISTING student and silently post fees onto their ledger.
      const newIdSql = sql`(SELECT id FROM users WHERE student_id = ${studentId})`;
      let inserted: { id: number }[] | null = null;
      try {
        const [userRes] = await db.batch([
          db.insert(users).values(userValues).returning({ id: users.id }),
          db
            .insert(feeLedgers)
            .values(ledgerValues(newIdSql, feeLines, feeOptions, actorId)),
        ]);
        inserted = userRes;
      } catch (err) {
        // Most likely a unique-constraint hit. Confirm by looking, rather than
        // by parsing driver error text; anything else is re-thrown as unknown.
        const [existing] = await db
          .select({ id: users.id })
          .from(users)
          .where(
            email
              ? or(eq(users.studentId, studentId), eq(users.email, email))
              : eq(users.studentId, studentId),
          )
          .limit(1);
        if (!existing) throw err;
      }

      if (inserted && inserted.length > 0) {
        created++;
        feeEntries += feeLines.length;
        await writeCustomValues(inserted[0].id, r, customTargets);
        continue;
      }

      // Duplicate. Optionally post the fees to the existing student.
      if (!feeOptions.updateExisting) {
        failed.push({ row: rowNo, reason: "duplicate" });
        continue;
      }
      const outcome = await postFeesToExisting(
        studentId,
        fullName,
        feeLines,
        feeOptions,
        actorId,
      );
      if (outcome.kind === "posted") {
        updated++;
        feeEntries += outcome.entries;
      } else if (outcome.kind === "alreadyPosted") {
        alreadyPosted++;
      } else {
        failed.push({ row: rowNo, reason: outcome.kind });
      }
    } catch (err) {
      logServerError("importStudentsFileAction", err, {
        row: rowNo,
        actorId,
      });
      failed.push({ row: rowNo, reason: "unknown" });
    }
  }

  if (created > 0) revalidatePath("/admin/users");
  if (feeEntries > 0) {
    revalidatePath("/admin/fees");
    revalidatePath("/student/fees");
    revalidatePath("/admin");
    revalidatePath("/student");
  }
  return { ok: true, created, updated, feeEntries, alreadyPosted, failed };
}

type ExistingOutcome =
  | { kind: "posted"; entries: number }
  | { kind: "alreadyPosted" }
  | { kind: "duplicate" | "nameMismatch" };

/**
 * Post a row's fee lines onto a student who already has an account.
 *
 * Two guards, because roll numbers are often reused across courses/years
 * ("Roll No. 1" exists in every class):
 *   1. The roll number must belong to a STUDENT whose name matches the sheet —
 *      otherwise the row is refused as `nameMismatch` and nothing is written.
 *   2. RE-RUN SAFE: a line identical to one already on that date (same
 *      particulars, side and amount) is skipped, so uploading the same sheet
 *      twice does not double-charge anyone.
 */
async function postFeesToExisting(
  studentId: string,
  fullName: string,
  lines: FeeLine[],
  options: FeeOptions,
  actorId: number,
): Promise<ExistingOutcome> {
  const [student] = await db
    .select({ id: users.id, role: users.role, fullName: users.fullName })
    .from(users)
    .where(eq(users.studentId, studentId))
    .limit(1);

  // The collision was on email (or the roll number is a staff account).
  if (!student || student.role !== "student") return { kind: "duplicate" };
  if (!sameName(student.fullName, fullName)) return { kind: "nameMismatch" };

  const sameDay = await db
    .select({
      particulars: feeLedgers.particulars,
      type: feeLedgers.type,
      amount: feeLedgers.amount,
    })
    .from(feeLedgers)
    .where(
      and(eq(feeLedgers.studentId, student.id), eq(feeLedgers.date, options.date)),
    );
  const seen = new Set(
    sameDay.map((e) => `${e.type}|${e.particulars}|${Math.round(e.amount * 100)}`),
  );

  const fresh = ledgerValues(student.id, lines, options, actorId).filter(
    (v) => !seen.has(`${v.type}|${v.particulars}|${Math.round(v.amount * 100)}`),
  );
  if (fresh.length === 0) return { kind: "alreadyPosted" };

  await db.insert(feeLedgers).values(fresh);
  return { kind: "posted", entries: fresh.length };
}

/**
 * Persist the mapped custom-column values for one freshly created user.
 *
 * Each value is validated against its column's declared type (a `select` column
 * only ever stores one of its own options). Blank and invalid values are simply
 * not written — absent and blank mean the same thing to every reader, so the
 * table stays proportional to real data rather than to users x fields.
 */
async function writeCustomValues(
  userId: number,
  row: Record<string, string | undefined>,
  customTargets: CustomField[],
): Promise<void> {
  const rows: { userId: number; fieldId: number; value: string }[] = [];

  for (const field of customTargets) {
    const value = (row[customColumnKey(field.key)] ?? "").trim();
    if (!value) continue;
    if (validateFieldValue(field, value)) continue; // type mismatch -> skip
    rows.push({ userId, fieldId: field.id, value });
  }

  if (rows.length === 0) return;
  try {
    await db.insert(userFieldValues).values(rows).onConflictDoNothing();
  } catch (err) {
    // Never fail the import over a custom column — the account is already
    // created and correct; the extra column is simply left blank.
    logServerError("importStudentsFileAction.customValues", err, { userId });
  }
}
