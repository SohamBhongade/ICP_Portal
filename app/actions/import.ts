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
import { users } from "@/db/schema";
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

/** Fields a roster column can be mapped onto. Mirrors the client's FIELDS. */
const TARGET_FIELDS = [
  "fullName",
  "studentId",
  "email",
  "phone",
  "course",
  "className",
  "practicalBatch",
] as const;
export type TargetField = (typeof TARGET_FIELDS)[number];

/** Chosen mapping: target field -> source column header. Strict, bounded. */
const mappingSchema = z.strictObject(
  Object.fromEntries(
    TARGET_FIELDS.map((f) => [
      f,
      z.string().trim().min(1).max(LIMITS.shortText).optional(),
    ]),
  ) as Record<TargetField, z.ZodOptional<z.ZodString>>,
);

export type ImportMapping = Partial<Record<TargetField, string>>;

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
    limits: {
      maxRows: IMPORT_LIMITS.maxRows,
      maxCellLength: IMPORT_LIMITS.maxCellLength,
      maxFileBytes: IMPORT_LIMITS.maxFileBytes,
    },
  };
}

/** Apply the operator's column mapping to one sanitized sheet row. */
function applyMapping(
  row: Record<string, string>,
  mapping: ImportMapping,
): Record<TargetField, string | undefined> {
  const out = {} as Record<TargetField, string | undefined>;
  for (const field of TARGET_FIELDS) {
    const header = mapping[field];
    out[field] = header ? (row[header] ?? "") || undefined : undefined;
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
  const mapping = mappingParsed.data as ImportMapping;

  // RE-PARSE. The preview's rows went through the client and are not trusted.
  const parsed = await parseImportFile(file);
  if (!parsed.ok) return { ok: false, error: parsed.reason };

  return insertRows(parsed.sheet, mapping, actor.id);
}

/** Shared insert loop. Business rules are unchanged from the previous flow. */
async function insertRows(
  sheet: ParsedSheet,
  mapping: ImportMapping,
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

      if (res.length === 0) failed.push({ row: rowNo, reason: "duplicate" });
      else created++;
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
