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
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { userFieldValues, users } from "@/db/schema";
import { currentUserWithCapability } from "@/lib/auth";
import { extractYear, normalizeCourse, resolveCourse } from "@/lib/courses";
import { logServerError } from "@/lib/errors";
import { RULES, checkRateLimit } from "@/lib/rate-limit";
import {
  IMPORT_LIMITS,
  parseImportFile,
  type ImportRejection,
  type ParsedSheet,
} from "@/lib/import/parse";
import { z, parseInput, LIMITS } from "@/lib/validation/core";
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
): { mapping: ImportMapping; customTargets: CustomField[] } {
  const byColumnKey = new Map(fields.map((f) => [customColumnKey(f.key), f]));
  const mapping: ImportMapping = {};
  const customTargets: CustomField[] = [];

  for (const [target, header] of Object.entries(raw)) {
    if (BUILT_IN_TARGETS.has(target)) {
      mapping[target as BuiltInTargetField] = header;
      continue;
    }
    const field = byColumnKey.get(target);
    if (field) {
      mapping[target] = header;
      customTargets.push(field);
    }
    // Anything else is silently dropped: an unknown target is a stale or forged
    // key, and refusing the whole import over one would strand the operator.
  }
  return { mapping, customTargets };
}

export type ImportError =
  | "forbidden"
  | "rateLimited"
  | "missingFile"
  | "badMapping"
  | ImportRejection;

export type PreviewResult =
  | {
      ok: true;
      headers: string[];
      rows: Record<string, string>[];
      /** Live custom columns, offered as additional mapping targets. */
      customFields: CustomField[];
      limits: { maxRows: number; maxCellLength: number; maxFileBytes: number };
    }
  | { ok: false; error: ImportError; retryAfter?: number };

export type RowFailure = {
  row: number;
  reason: "missingName" | "missingRollNo" | "invalidEmail" | "invalidCourse" | "duplicate" | "unknown";
};

export type ImportResult =
  | { ok: true; created: number; failed: RowFailure[] }
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
  const { mapping, customTargets } = resolveMapping(
    mappingParsed.data as Record<string, string>,
    fields,
  );

  // RE-PARSE. The preview's rows went through the client and are not trusted.
  const parsed = await parseImportFile(file);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  return insertRows(parsed.sheet, mapping, customTargets, actor.id);
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
  actorId: number,
): Promise<ImportResult> {
  let created = 0;
  const failed: RowFailure[] = [];

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

    try {
      const passwordHash = await bcrypt.hash(`Icp@${studentId}`, BCRYPT_COST);
      const res = await db
        .insert(users)
        .values({
          fullName,
          studentId,
          email,
          phone: r.phone?.trim() || undefined,
          role: "student",
          status: "active",
          course: norm.course ?? undefined,
          year,
          className: r.className?.trim() || undefined,
          practicalBatch: r.practicalBatch?.trim() || undefined,
          passwordHash,
        })
        .onConflictDoNothing()
        .returning({ id: users.id });

      if (res.length === 0) {
        failed.push({ row: rowNo, reason: "duplicate" });
      } else {
        created++;
        await writeCustomValues(res[0].id, r, customTargets);
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
  return { ok: true, created, failed };
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
