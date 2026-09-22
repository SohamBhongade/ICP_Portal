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
import { and, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { feeLedgers, userFieldValues, users } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { can, type Role } from "@/lib/auth/permissions";
import { todayIso } from "@/lib/dates";
import { readAdmissionYear } from "@/lib/academic-year";
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
  coerceFieldValue,
  customColumnKey,
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
  "admissionYear",
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
      /** Worksheet these rows came from (xlsx only). */
      sheetName?: string;
      /** Every visible worksheet, in tab order, so the operator can switch. */
      sheetNames?: string[];
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
    /** A mapped date/year cell could not be read. See `column` + `detail`. */
    | "unreadableDate"
    | "duplicate"
    | "nameMismatch"
    | "unknown";
  /** For invalidFee: the stored value of the category whose cell was bad. */
  detail?: string;
  /** For unreadableDate: the human label of the column that failed. */
  column?: string;
  /** For unreadableDate: the raw cell text, so the operator can see the typo. */
  raw?: string;
};

/**
 * One cell that could not be stored, reported per row AND per column.
 *
 * The bug this exists for: an unparseable date used to be discarded with no
 * error at all, so an operator saw "Imported 20 students" and three blank
 * columns. EVERY unreadable cell is listed here with the raw text that caused
 * it, whether or not the row itself was written — `failed` says which rows were
 * refused, this says which values were lost.
 */
export type CellIssue = {
  row: number;
  /** The portal column's display label ("D.O.B", "Year of Leaving"). */
  column: string;
  /** The raw cell text exactly as the sheet held it. */
  raw: string;
  /** Why it could not be read. The UI translates this. */
  issue: "notDate" | "notYear" | "notNumber" | "notAnOption" | "tooLong";
};

export type ImportResult =
  | {
      ok: true;
      created: number;
      /** Existing students updated (admission year and/or fees) — updateExisting only. */
      updated: number;
      /** Ledger rows written, across new and existing students. */
      feeEntries: number;
      /** Existing students matched but already up to date (nothing to change). */
      unchanged: number;
      failed: RowFailure[];
      /** Every cell that could not be read. See the type's note. */
      cellIssues: CellIssue[];
    }
  | { ok: false; error: ImportError; retryAfter?: number };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const BCRYPT_COST = 12;

/** Admin-only gate, identical to the one on every other creation path. */
async function assertCreateUsers() {
  return currentUserWithCapability("createUsers");
}

/**
 * The worksheet the operator picked, or undefined for "the first visible tab".
 * Bounded like every other client-supplied string; an unknown name simply
 * falls back to the default inside the parser.
 */
function sheetFrom(formData: FormData): string | undefined {
  const raw = formData.get("sheet");
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return trimmed && trimmed.length <= LIMITS.shortText ? trimmed : undefined;
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

  // WHICH TAB. A workbook can hold last year's roster on another tab, so the
  // dialog offers a picker; the chosen name comes back with every later call.
  const sheetName = sheetFrom(formData);

  const parsed = await parseImportFile(file, sheetName);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  return {
    ok: true,
    headers: parsed.sheet.headers,
    rows: parsed.sheet.rows,
    sheetName: parsed.sheet.sheetName,
    sheetNames: parsed.sheet.sheetNames,
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

  // Update students who already exist (matched by roll number AND name)
  // instead of reporting them as duplicates. Off unless the operator ticks it.
  const updateExisting = formData.get("updateExisting") === "true";

  // Import a row even though one of its date/year cells is unreadable, leaving
  // that cell blank. OFF by default, on purpose: the default must be to REFUSE
  // the row and say why, because the failure mode this whole change exists to
  // fix was importing silently with the value dropped. The operator has to
  // choose to accept the blank, having seen it in the preview.
  const allowBlankDates = formData.get("allowBlankDates") === "true";

  // RE-PARSE, from the SAME tab the preview showed. The preview's rows went
  // through the client and are not trusted; the tab NAME is just a selector,
  // and an unknown one falls back to the first visible sheet.
  const parsed = await parseImportFile(file, sheetFrom(formData));
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  return insertRows(
    parsed.sheet,
    mapping,
    customTargets,
    feeTargets,
    feeOptions,
    { updateExisting, allowBlankDates },
    actor.id,
  );
}

/**
 * Display label for the built-in admission-year column in a CellIssue.
 *
 * A literal rather than an i18n key: custom columns report their own (already
 * untranslatable) label, and a mixed list of keys and labels would be worse
 * than one consistently-English one. Matches onboarding.csv.fieldAdmissionYear.
 */
const ADMISSION_YEAR_LABEL = "Year of admission";

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
 * DATE AND YEAR CELLS (the fix). Every mapped date-ish cell is normalized
 * through lib/import/dates.ts BEFORE anything is written — Excel serials,
 * DD/MM/YYYY, academic years and all. A cell that still cannot be read is
 * RECORDED in `cellIssues` with its raw text, and by default the whole row is
 * refused with `unreadableDate` rather than created with the value missing.
 *
 * What this replaces: `if (validateFieldValue(field, value)) continue;`. That
 * line ran a strict YYYY-MM-DD check against a raw Excel serial and then
 * dropped the value with no error, no log and no row failure. It is the reason
 * D.O.B, Year of Admission and Year of Leaving arrived blank on every .xlsx
 * import while Caste — a `text` column, which has no such check — arrived fine.
 *
 * Custom column values are still written AFTER the user row, keyed by the id
 * the insert returned, and a write failure there still never costs the student
 * their account.
 */
async function insertRows(
  sheet: ParsedSheet,
  mapping: ImportMapping,
  customTargets: CustomField[],
  feeTargets: FeeCategory[],
  feeOptions: FeeOptions | null,
  flags: { updateExisting: boolean; allowBlankDates: boolean },
  actorId: number,
): Promise<ImportResult> {
  const { updateExisting, allowBlankDates } = flags;
  let created = 0;
  let updated = 0;
  let feeEntries = 0;
  let unchanged = 0;
  const failed: RowFailure[] = [];
  const cellIssues: CellIssue[] = [];
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

    // DATE / YEAR CELLS — normalized and checked BEFORE any write, so an
    // unreadable one is reported rather than quietly lost.
    const rowIssues: CellIssue[] = [];

    // "2024-25" / "2024-2025" / Excel serial -> 2024.
    const admissionRaw = (r.admissionYear ?? "").trim();
    const admission = readAdmissionYear(admissionRaw);
    const admissionYear = admission.ok ? (admission.value ?? undefined) : undefined;
    if (!admission.ok) {
      rowIssues.push({
        row: rowNo,
        column: ADMISSION_YEAR_LABEL,
        raw: admissionRaw,
        issue: "notYear",
      });
    }

    // Custom columns. Coercion happens here rather than inside the write so a
    // bad cell can block the row before an account exists for it.
    const customValues: { fieldId: number; value: string }[] = [];
    for (const field of customTargets) {
      const raw = (r[customColumnKey(field.key)] ?? "").trim();
      if (!raw) continue;
      const coerced = coerceFieldValue(field, raw);
      if (!coerced.ok) {
        rowIssues.push({
          row: rowNo,
          column: field.label,
          raw,
          issue: coerced.issue,
        });
        continue;
      }
      if (coerced.value) {
        customValues.push({ fieldId: field.id, value: coerced.value });
      }
    }

    // Every unreadable cell is reported either way. Whether the ROW survives is
    // the operator's choice — and the default is that it does not.
    cellIssues.push(...rowIssues);
    const blockingIssue = rowIssues.find((issue) => {
      // "Import anyway" is specifically about DATES: it lets an operator accept
      // a blank birthday rather than lose the student. A bad `select` or
      // `number` cell is a different mistake and still refuses the row.
      const isDateIssue = issue.issue === "notDate" || issue.issue === "notYear";
      return allowBlankDates ? !isDateIssue : true;
    });
    if (blockingIssue) {
      failed.push({
        row: rowNo,
        reason: "unreadableDate",
        column: blockingIssue.column,
        raw: blockingIssue.raw,
      });
      continue;
    }

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
        admissionYear,
        passwordHash,
      };

      // A roll number that already exists: either update that student (when
      // the operator asked for it) or report the row as a duplicate.
      const handleExisting = async () => {
        if (!updateExisting) {
          failed.push({ row: rowNo, reason: "duplicate" });
          return;
        }
        const outcome = await updateExistingStudent(
          studentId,
          fullName,
          { admissionYear, customValues, feeLines, feeOptions },
          actorId,
        );
        if (outcome.kind === "updated") {
          updated++;
          feeEntries += outcome.entries;
        } else if (outcome.kind === "unchanged") {
          unchanged++;
        } else {
          failed.push({ row: rowNo, reason: outcome.kind });
        }
      };

      if (feeLines.length === 0 || !feeOptions) {
        // No fees for this row — the original path, unchanged.
        const res = await db
          .insert(users)
          .values(userValues)
          .onConflictDoNothing()
          .returning({ id: users.id });

        if (res.length === 0) {
          await handleExisting();
        } else {
          created++;
          await writeCustomValues(res[0].id, customValues);
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
        await writeCustomValues(inserted[0].id, customValues);
        continue;
      }

      await handleExisting();
    } catch (err) {
      logServerError("importStudentsFileAction", err, {
        row: rowNo,
        actorId,
      });
      failed.push({ row: rowNo, reason: "unknown" });
    }
  }

  if (created > 0 || updated > 0) revalidatePath("/admin/users");
  if (feeEntries > 0 || updated > 0) {
    revalidatePath("/admin/fees");
    revalidatePath("/student/fees");
    revalidatePath("/admin");
    revalidatePath("/student");
  }
  return { ok: true, created, updated, feeEntries, unchanged, failed, cellIssues };
}

type ExistingOutcome =
  | { kind: "updated"; entries: number }
  | { kind: "unchanged" }
  | { kind: "duplicate" | "nameMismatch" };

/**
 * Bring a student who already has an account up to date from the sheet:
 * fill/correct their admission year, their custom column values, and post the
 * row's fee lines.
 *
 * CUSTOM VALUES ARE PART OF THIS (new). They were not, which made re-uploading
 * the same roster with "update existing students" ticked useless as a recovery
 * path — the natural way to backfill the D.O.B / Year of Leaving columns that
 * the old silent-drop bug emptied. Only values that actually DIFFER are
 * written, so the `unchanged` count still means what it says and a re-run of an
 * already-correct sheet stays a no-op.
 *
 * Two guards, because roll numbers are often reused across courses/years
 * ("Roll No. 1" exists in every class):
 *   1. The roll number must belong to a STUDENT whose name matches the sheet —
 *      otherwise the row is refused as `nameMismatch` and nothing is written.
 *   2. RE-RUN SAFE: a fee line identical to one already on that date (same
 *      particulars, side and amount) is skipped, so uploading the same sheet
 *      twice does not double-charge anyone.
 */
async function updateExistingStudent(
  studentId: string,
  fullName: string,
  changes: {
    admissionYear: number | undefined;
    customValues: { fieldId: number; value: string }[];
    feeLines: FeeLine[];
    feeOptions: FeeOptions | null;
  },
  actorId: number,
): Promise<ExistingOutcome> {
  const [student] = await db
    .select({
      id: users.id,
      role: users.role,
      fullName: users.fullName,
      admissionYear: users.admissionYear,
    })
    .from(users)
    .where(eq(users.studentId, studentId))
    .limit(1);

  // The collision was on email (or the roll number is a staff account).
  if (!student || student.role !== "student") return { kind: "duplicate" };
  if (!sameName(student.fullName, fullName)) return { kind: "nameMismatch" };

  let profileChanged = false;
  if (
    changes.admissionYear !== undefined &&
    changes.admissionYear !== student.admissionYear
  ) {
    await db
      .update(users)
      .set({ admissionYear: changes.admissionYear, updatedAt: new Date() })
      .where(eq(users.id, student.id));
    profileChanged = true;
  }

  // Custom columns: upsert only what differs from what is already stored.
  if (changes.customValues.length > 0) {
    const fieldIds = changes.customValues.map((v) => v.fieldId);
    const existingValues = await db
      .select({
        fieldId: userFieldValues.fieldId,
        value: userFieldValues.value,
      })
      .from(userFieldValues)
      .where(
        and(
          eq(userFieldValues.userId, student.id),
          inArray(userFieldValues.fieldId, fieldIds),
        ),
      );
    const stored = new Map(existingValues.map((v) => [v.fieldId, v.value ?? ""]));
    const changedValues = changes.customValues.filter(
      (v) => stored.get(v.fieldId) !== v.value,
    );
    if (changedValues.length > 0) {
      try {
        // ONE multi-row upsert. UNIQUE(user_id, field_id) turns the conflict
        // clause into an update, and `excluded.value` is the row SQLite was
        // about to insert — so each row updates to its OWN new value rather
        // than every row collapsing onto one literal.
        await db
          .insert(userFieldValues)
          .values(changedValues.map((v) => ({ userId: student.id, ...v })))
          .onConflictDoUpdate({
            target: [userFieldValues.userId, userFieldValues.fieldId],
            set: { value: sql`excluded.value`, updatedAt: new Date() },
          });
        profileChanged = true;
      } catch (err) {
        // Same rule as on create: a custom column never sinks the row.
        logServerError("importStudentsFileAction.updateCustomValues", err, {
          userId: student.id,
        });
      }
    }
  }

  let entries = 0;
  const options = changes.feeOptions;
  if (options && changes.feeLines.length > 0) {
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
    const fresh = ledgerValues(student.id, changes.feeLines, options, actorId).filter(
      (v) => !seen.has(`${v.type}|${v.particulars}|${Math.round(v.amount * 100)}`),
    );
    if (fresh.length > 0) {
      await db.insert(feeLedgers).values(fresh);
      entries = fresh.length;
    }
  }

  return profileChanged || entries > 0
    ? { kind: "updated", entries }
    : { kind: "unchanged" };
}

/**
 * Persist already-coerced custom-column values for one freshly created user.
 *
 * NOTE THE SIGNATURE CHANGE. This used to take the raw row and do its own
 * `validateFieldValue(...) -> continue` check, which is where every date value
 * was being discarded without a word. Coercion and reporting now happen in the
 * caller, BEFORE the account exists, so by the time we get here every value is
 * already in its stored shape and an unreadable one has been accounted for.
 * The only thing that can go wrong here is the write itself.
 */
async function writeCustomValues(
  userId: number,
  values: { fieldId: number; value: string }[],
): Promise<void> {
  if (values.length === 0) return;
  try {
    await db
      .insert(userFieldValues)
      .values(values.map((v) => ({ userId, ...v })))
      .onConflictDoNothing();
  } catch (err) {
    // Never fail the import over a custom column — the account is already
    // created and correct; the extra column is simply left blank.
    logServerError("importStudentsFileAction.customValues", err, { userId });
  }
}
