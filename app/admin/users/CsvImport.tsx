"use client";

// Bulk student import — drag-and-drop .csv / .xlsx, a column-mapping step, then
// a validated preview before anything is written.
//
// PARSING IS SERVER-SIDE (Phase 4). This component never parses the file; it
// uploads it and renders what the server says it contains. The previous version
// parsed with papaparse in the browser and posted an array of rows, which meant
// every limit — size, real file type, row cap, cell cap, formula neutralization
// — lived in code the caller controlled.
//
// Flow:
//   1. Drop / pick a file -> POST it to parseImportFileAction, which enforces
//      the size / type / row / cell limits and returns sanitized headers+rows.
//   2. Map each portal field to a column (auto-guessed, admin can adjust).
//   3. Live validation flags malformed emails / missing mandatory fields AND
//      shows every mapped date / year / custom column RENDERED AS IT WILL BE
//      SAVED. That preview column is the point: a date the importer cannot read
//      is visible here, before anything is written, instead of turning into a
//      blank cell in the grid afterwards. Preview only — the server re-checks
//      and re-parses every row on import, using the same normalizer
//      (lib/import/dates.ts) so the two can never disagree.
//   4. The same File plus the mapping go to importStudentsFileAction, which
//      RE-PARSES server-side and writes. The previewed rows are never trusted
//      for the write, because they made a round trip through this browser.
//
// FEE COLUMNS (optional). Columns such as "Tuition fees", "Development fees"
// and "Scholarships" can be mapped onto fee-ledger categories. Each non-zero
// cell becomes one ledger entry for that student, posted on the chosen date.
// Only shown to operators holding `feeWrites`; the server re-checks.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, X } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  importStudentsFileAction,
  parseImportFileAction,
  type ImportError,
  type TargetField,
} from "@/app/actions/import";
import { extractYear, normalizeCourse, resolveCourse } from "@/lib/courses";
import {
  coerceFieldValue,
  customColumnKey,
  type CustomField,
} from "@/lib/user-fields";
import {
  balanceToneClass,
  feeCategoriesFor,
  formatCurrency,
  type FeeCategory,
} from "@/lib/fees";
import {
  FEE_TARGET_GUESSES,
  SCHOLARSHIP_VALUE,
  TUITION_VALUE,
  buildFeeLines,
  feeLinesBalance,
  feeTargetKey,
} from "@/lib/import/fee-columns";
import type { CellIssue, RowFailure } from "@/app/actions/import";
import { readAdmissionYear } from "@/lib/academic-year";
import type { ToastKind } from "./UsersContent";

/** Row shape after the operator's column mapping is applied (preview only). */
type MappedRow = Partial<Record<string, string>>;

/** Preview-only validation codes; the server owns the authoritative ones. */
type PreviewIssue =
  | "missingName"
  | "missingRollNo"
  | "invalidEmail"
  | "invalidCourse"
  | "invalidFee"
  /** A mapped date / year / custom cell could not be read. */
  | "unreadableDate";

/** How many rows the preview shows before the operator asks for the rest. */
const PREVIEW_ROWS = 10;

/**
 * One mapped column whose value is TRANSFORMED on the way in, and therefore
 * has to be previewed as it will be stored rather than as it was typed.
 *
 * That is every custom column (each has a declared type) plus the built-in
 * admission year. A roll number or an email is stored verbatim, so showing the
 * raw cell for those is already showing what will be saved.
 */
type ResolvedColumn = {
  /** The mapped-row key to read. */
  key: string;
  label: string;
} & (
  | { kind: "admissionYear" }
  | { kind: "custom"; field: CustomField }
);

/** What one such cell will actually become. */
type ResolvedCell = {
  raw: string;
  /** The stored value, or "" when blank or unreadable. */
  saved: string;
  /** True when the cell held something we could not read. */
  bad: boolean;
};

// A mapping target as the UI renders it. Built-ins carry an i18n key; custom
// columns (Phase 9) carry the admin's own label verbatim.
type MapTarget = {
  key: TargetField;
  /** i18n key for a built-in; null for a custom column. */
  labelKey: string | null;
  /** Literal label for a custom column; null for a built-in. */
  label?: string;
  required: boolean;
  guesses: string[];
};

// Portal fields in display order. `required` drives mandatory-field validation;
// `guesses` are substrings used to auto-match a CSV header to this field.
const FIELDS: MapTarget[] = [
  { key: "fullName", labelKey: "onboarding.csv.fieldFullName", required: true, guesses: ["fullname", "name", "studentname"] },
  { key: "studentId", labelKey: "onboarding.csv.fieldRollNo", required: true, guesses: ["roll", "rollno", "rollnumber", "studentid", "id"] },
  { key: "email", labelKey: "onboarding.csv.fieldEmail", required: false, guesses: ["email", "mail"] },
  { key: "phone", labelKey: "onboarding.csv.fieldPhone", required: false, guesses: ["phone", "mobile", "contact"] },
  { key: "course", labelKey: "onboarding.csv.fieldCourse", required: false, guesses: ["course", "program"] },
  // Listed BEFORE className so "Year of admission" is claimed here and the
  // class field's "year" guess falls through to "Year of Study".
  { key: "admissionYear", labelKey: "onboarding.csv.fieldAdmissionYear", required: false, guesses: ["admission", "admitted"] },
  { key: "className", labelKey: "onboarding.csv.fieldClass", required: false, guesses: ["class", "year"] },
  { key: "practicalBatch", labelKey: "onboarding.csv.fieldBatch", required: false, guesses: ["batch", "practical"] },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RawRow = Record<string, string>;
type Mapping = Partial<Record<string, string>>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Every mapping target: the built-in fields, then one per live custom column.
 *
 * Custom targets are addressed by the SAME `custom:<key>` string the server
 * whitelists on import, so what the operator picks here is exactly what the
 * server validates — there is no translation step in between to get wrong.
 * The auto-guess for a custom column matches its own label, which is usually
 * what the spreadsheet header says too.
 */
function buildTargets(customFields: CustomField[]): MapTarget[] {
  return [
    ...FIELDS,
    ...customFields.map((f) => ({
      key: customColumnKey(f.key) as TargetField,
      labelKey: null,
      label: f.label,
      required: false,
      guesses: [norm(f.label), norm(f.key)].filter(Boolean),
    })),
  ];
}

/**
 * Fee-ledger targets, one per fee category, addressed as `fee:<value>` — the
 * same key the server whitelists. Charges first, then credits.
 */
function buildFeeTargets(): (MapTarget & { category: FeeCategory })[] {
  return [...feeCategoriesFor("charge"), ...feeCategoriesFor("payment")].map(
    (category) => ({
      key: feeTargetKey(category.value) as TargetField,
      labelKey: category.labelKey,
      required: false,
      guesses: FEE_TARGET_GUESSES[category.value] ?? [],
      category,
    }),
  );
}
const FEE_TARGETS = buildFeeTargets();

function guessMapping(headers: string[], targets: MapTarget[]): Mapping {
  const map: Mapping = {};
  const used = new Set<string>();
  for (const field of targets) {
    const hit = headers.find(
      (h) => !used.has(h) && field.guesses.some((g) => norm(h).includes(g)),
    );
    if (hit) {
      map[field.key] = hit;
      used.add(hit);
    }
  }
  return map;
}

export function CsvImport({
  onClose,
  notify,
}: {
  onClose: () => void;
  notify: (kind: ToastKind, message: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  // The File itself is kept so the import step can re-upload it for the
  // authoritative server-side parse — the operator never picks it twice.
  const [file, setFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [customFields, setCustomFields] = useState<CustomField[]>([]);
  // Worksheet (tab) being read, and every visible tab in the workbook. A
  // workbook often carries last year's roster on a second tab, and the
  // importer used to read whichever one happened to be stored first.
  const [sheetName, setSheetName] = useState("");
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);

  // Fee-ledger posting options (only used when a fee column is mapped).
  const [canPostFees, setCanPostFees] = useState(false);
  const [feeDate, setFeeDate] = useState("");
  const [feeNote, setFeeNote] = useState("");
  const [scholarshipOnTop, setScholarshipOnTop] = useState(true);
  const [updateExisting, setUpdateExisting] = useState(false);
  // Rows the server refused, shown after an import instead of closing blind.
  const [failures, setFailures] = useState<RowFailure[] | null>(null);
  // Cells the server could not read, reported alongside them.
  const [serverCellIssues, setServerCellIssues] = useState<CellIssue[]>([]);
  // Import a row whose date/year cell is unreadable, leaving that cell blank.
  // OFF by default — see the checkbox's own note.
  const [allowBlankDates, setAllowBlankDates] = useState(false);
  // The preview shows the first PREVIEW_ROWS rows; this opens it up.
  const [showAllRows, setShowAllRows] = useState(false);

  // Built-ins plus whatever custom columns exist right now.
  const targets = useMemo(() => buildTargets(customFields), [customFields]);

  // Upload for parsing. The server decides whether the file is acceptable and
  // what it contains; this component only renders the answer.
  const parseFile = (file: File, sheet?: string) => {
    startTransition(async () => {
      const body = new FormData();
      body.append("file", file);
      // Which worksheet to read. Omitted on the first parse, which makes the
      // server pick the first visible tab and tell us what the others are.
      if (sheet) body.append("sheet", sheet);
      const res = await parseImportFileAction(body);
      if (!res.ok) {
        notify("error", importErrorMessage(res.error, res.retryAfter));
        return;
      }
      setFile(file);
      setFileName(file.name);
      setHeaders(res.headers);
      setRows(res.rows);
      setCustomFields(res.customFields);
      setSheetName(res.sheetName ?? "");
      setSheetNames(res.sheetNames ?? []);
      setCanPostFees(res.canPostFees);
      setFeeDate(res.today);
      // Fee columns are guessed AFTER the roster fields, so a header can never
      // be claimed by both. Offered only to operators who may post fees.
      const all = [
        ...buildTargets(res.customFields),
        ...(res.canPostFees ? FEE_TARGETS : []),
      ];
      setMapping(guessMapping(res.headers, all));
    });
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) parseFile(file);
  };

  /** Translate a server rejection into a message. Keys live under onboarding.csv.errors. */
  function importErrorMessage(error: ImportError, retryAfter?: number): string {
    if (error === "rateLimited") {
      return t("onboarding.csv.errors.rateLimited", {
        minutes: Math.max(1, Math.ceil((retryAfter ?? 60) / 60)),
      });
    }
    return t(`onboarding.csv.errors.${error}`);
  }

  // Map each raw row to our schema shape using the current column mapping.
  const mapped: MappedRow[] = useMemo(() => {
    return rows.map((r) => {
      const get = (k: string) => {
        const h = mapping[k];
        return h ? (r[h] ?? "").trim() : "";
      };
      const out: MappedRow = {
        fullName: get("fullName"),
        studentId: get("studentId"),
        email: get("email") || undefined,
        phone: get("phone") || undefined,
        course: get("course") || undefined,
        className: get("className") || undefined,
        practicalBatch: get("practicalBatch") || undefined,
        admissionYear: get("admissionYear") || undefined,
      };
      // Custom columns ride along under their `custom:<key>` target so the
      // preview and the server see the identical shape.
      for (const f of customFields) {
        const key = customColumnKey(f.key);
        out[key] = get(key) || undefined;
      }
      return out;
    });
  }, [rows, mapping, customFields]);

  // --- What the transformed columns will actually store --------------------
  //
  // THIS IS THE FIX'S VISIBLE HALF. Every mapped column whose value is parsed
  // rather than stored verbatim gets previewed through the SAME functions the
  // server writes with, so a cell the importer cannot read is impossible to
  // miss: it is red, in the table, with the raw text beside it, before anything
  // is committed. The old behaviour was to drop such a value without a word.
  const resolvedColumns = useMemo<ResolvedColumn[]>(() => {
    const columns: ResolvedColumn[] = [];
    if (mapping.admissionYear) {
      columns.push({
        kind: "admissionYear",
        key: "admissionYear",
        label: t("onboarding.csv.fieldAdmissionYear"),
      });
    }
    for (const field of customFields) {
      const key = customColumnKey(field.key);
      if (!mapping[key]) continue;
      columns.push({ kind: "custom", key, label: field.label, field });
    }
    return columns;
  }, [mapping, customFields, t]);

  const resolvedCells = useMemo<ResolvedCell[][]>(
    () =>
      mapped.map((row) =>
        resolvedColumns.map((column) => {
          const raw = (row[column.key] ?? "").trim();
          if (column.kind === "admissionYear") {
            const out = readAdmissionYear(raw);
            return {
              raw,
              saved: out.ok && out.value != null ? String(out.value) : "",
              bad: !out.ok,
            };
          }
          const out = coerceFieldValue(column.field, raw);
          return { raw, saved: out.ok ? out.value : "", bad: !out.ok };
        }),
      ),
    [mapped, resolvedColumns],
  );

  /** Rows holding at least one cell we could not read. */
  const rowHasBadCell = useMemo(
    () => resolvedCells.map((cells) => cells.some((c) => c.bad)),
    [resolvedCells],
  );

  /**
   * Per-COLUMN roll-up of the per-row failures: "3 rows: couldn't read Year of
   * Leaving — for example 45231". A flat list of 300 identical row errors is
   * not a report; the column and a sample of the raw values are what tell the
   * operator which spreadsheet column to go and fix.
   */
  const cellIssueSummary = useMemo(() => {
    const byColumn = new Map<string, { count: number; samples: string[] }>();
    resolvedCells.forEach((cells) => {
      cells.forEach((cell, c) => {
        if (!cell.bad) return;
        const label = resolvedColumns[c].label;
        const entry = byColumn.get(label) ?? { count: 0, samples: [] };
        entry.count++;
        if (cell.raw && entry.samples.length < 3 && !entry.samples.includes(cell.raw)) {
          entry.samples.push(cell.raw);
        }
        byColumn.set(label, entry);
      });
    });
    return Array.from(byColumn, ([column, v]) => ({ column, ...v }));
  }, [resolvedCells, resolvedColumns]);

  // Fee categories the operator has actually mapped to a column.
  const mappedFeeTargets = useMemo(
    () => (canPostFees ? FEE_TARGETS.filter((f) => mapping[f.key]) : []),
    [canPostFees, mapping],
  );
  const tuitionAndScholarshipMapped =
    !!mapping[feeTargetKey(TUITION_VALUE)] &&
    !!mapping[feeTargetKey(SCHOLARSHIP_VALUE)];

  // Per-row ledger lines, computed with the SAME function the server uses.
  const feeResults = useMemo(
    () =>
      rows.map((r) => {
        const cells: Record<string, string | undefined> = {};
        for (const f of mappedFeeTargets) {
          cells[f.category.value] = r[mapping[f.key]!] ?? "";
        }
        return buildFeeLines(cells, { scholarshipOnTop });
      }),
    [rows, mapping, mappedFeeTargets, scholarshipOnTop],
  );

  // Per-row client validation -> error code (or null = ready). Mirrors the
  // authoritative server checks so the preview never disagrees with the import.
  const validations: (PreviewIssue | null)[] = useMemo(() => {
    return mapped.map((row, i) => {
      if (!row.fullName) return "missingName";
      if (!row.studentId) return "missingRollNo";
      if (row.email && !EMAIL_RE.test(row.email)) return "invalidEmail";
      if (resolveCourse(row.course).status === "invalid") return "invalidCourse";
      if (!feeResults[i]?.ok) return "invalidFee";
      // An unreadable date is a ROW error by default rather than a shrug. The
      // operator can downgrade it with the "import anyway" checkbox, having
      // seen in the table above exactly which cells that affects.
      if (!allowBlankDates && rowHasBadCell[i]) return "unreadableDate";
      return null;
    });
  }, [mapped, feeResults, rowHasBadCell, allowBlankDates]);

  // The canonical course each row will actually be saved as ("" when none).
  const resolvedCourses: string[] = useMemo(
    () =>
      mapped.map((row) => {
        const res = resolveCourse(row.course);
        return res.status === "ok" ? res.value : "";
      }),
    [mapped],
  );

  // The academic year each row will be saved with — pulled from the course cell
  // ("1st year B.Pharm") or, failing that, the class cell. "" when none. Mirrors
  // the server's derivation so the preview matches exactly what gets stored.
  const resolvedYears: string[] = useMemo(
    () =>
      mapped.map((row) => {
        const year =
          normalizeCourse(row.course).year ?? extractYear(row.className ?? "").year;
        return year != null ? String(year) : "";
      }),
    [mapped],
  );

  const validRows = useMemo(
    () => mapped.filter((_, i) => validations[i] === null),
    [mapped, validations],
  );

  /** The rows the preview table actually renders. */
  const visibleRows = useMemo(
    () => (showAllRows ? mapped : mapped.slice(0, PREVIEW_ROWS)),
    [mapped, showAllRows],
  );
  const invalidCount = rows.length - validRows.length;

  /**
   * WHICH rows will be skipped, and why — across the WHOLE file.
   *
   * The preview shows ten rows; the bad row is regularly not one of them, so
   * "1 with errors" used to be a number with no way to chase it down. This
   * groups every refusal by reason and names the row numbers, so the operator
   * can go straight to that line in the spreadsheet.
   */
  const rowIssueSummary = useMemo(() => {
    const byReason = new Map<PreviewIssue, number[]>();
    validations.forEach((issue, i) => {
      if (!issue) return;
      const rows = byReason.get(issue) ?? [];
      rows.push(i + 1);
      byReason.set(issue, rows);
    });
    return Array.from(byReason, ([reason, rowNumbers]) => ({
      reason,
      rowNumbers,
    }));
  }, [validations]);

  const reset = () => {
    setFailures(null);
    setServerCellIssues([]);
    setAllowBlankDates(false);
    setShowAllRows(false);
    setFile(null);
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    setSheetName("");
    setSheetNames([]);
    if (inputRef.current) inputRef.current.value = "";
  };

  const doImport = () => {
    if (!file || validRows.length === 0) return;
    startTransition(async () => {
      // Send the FILE and the mapping. The server re-parses from scratch — the
      // previewed rows above are not the data that gets written.
      const body = new FormData();
      body.append("file", file);
      // Fee targets are dropped when this operator may not post fees, so the
      // request never asks for something the server will refuse.
      const sent = canPostFees
        ? mapping
        : Object.fromEntries(
            Object.entries(mapping).filter(([k]) => !k.startsWith("fee:")),
          );
      body.append("mapping", JSON.stringify(sent));
      if (mappedFeeTargets.length > 0) {
        body.append(
          "feeOptions",
          JSON.stringify({
            date: feeDate,
            note: feeNote,
            scholarshipOnTop,
          }),
        );
      }
      // The SAME tab the preview read — the server re-parses from scratch.
      if (sheetName) body.append("sheet", sheetName);
      if (updateExisting) body.append("updateExisting", "true");
      if (allowBlankDates) body.append("allowBlankDates", "true");
      const result = await importStudentsFileAction(body);
      if (!result.ok) {
        notify("error", importErrorMessage(result.error, result.retryAfter));
        return;
      }
      let message =
        result.failed.length > 0
          ? t("onboarding.toast.importedWithErrors", {
              created: result.created,
              failed: result.failed.length,
            })
          : t("onboarding.toast.imported", { created: result.created });
      if (result.updated > 0 || result.unchanged > 0) {
        message +=
          " " +
          t("onboarding.toast.existingUpdated", {
            updated: result.updated,
            unchanged: result.unchanged,
          });
      }
      if (result.feeEntries > 0) {
        message +=
          " " + t("onboarding.toast.feesPosted", { entries: result.feeEntries });
      }
      // A cell that went in blank is stated in the SAME breath as the success,
      // never left for the operator to notice in the grid three days later.
      if (result.cellIssues.length > 0) {
        message +=
          " " +
          t("onboarding.csv.importedBlank", {
            count: result.cellIssues.length,
          });
      }
      notify(
        result.cellIssues.length > 0 ? "error" : "success",
        message,
      );
      router.refresh();
      // Keep the dialog open on any partial outcome so the operator can see
      // exactly which rows were skipped, or which cells arrived empty, and why.
      if (result.failed.length > 0 || result.cellIssues.length > 0) {
        setFailures(result.failed);
        setServerCellIssues(result.cellIssues);
        return;
      }
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
      <button
        type="button"
        aria-label={t("common.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />

      <div
        role="dialog"
        aria-modal="true"
        className="relative my-8 w-full max-w-3xl rounded-lg bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            <Editable tKey="onboarding.csv.title" />
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common.cancel")}
            className="rounded p-1 text-muted hover:bg-lavender hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex flex-col gap-5 p-5">
          {/* Step 1: drop zone */}
          {!fileName ? (
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                onFiles(e.dataTransfer.files);
              }}
              onClick={() => inputRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed px-6 py-12 text-center transition-colors ${
                dragging
                  ? "border-teal bg-mint/40"
                  : "border-line bg-canvas hover:bg-lavender/40"
              }`}
            >
              <FileUp className="size-8 text-teal" />
              <p className="text-sm text-muted">{t("onboarding.csv.dropHint")}</p>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-canvas px-3 py-2 text-sm">
                <span className="text-ink">
                  {t("onboarding.csv.fileSelected", {
                    name: fileName,
                    count: rows.length,
                  })}
                  {sheetName && (
                    <span className="text-muted">
                      {" "}
                      {t("onboarding.csv.sheetReading", { sheet: sheetName })}
                    </span>
                  )}
                </span>
                <span className="flex items-center gap-3">
                  {/* Only when the workbook actually has more than one tab —
                      otherwise this is a dropdown with a single choice. */}
                  {sheetNames.length > 1 && file && (
                    <label className="flex items-center gap-2 text-xs text-muted">
                      {t("onboarding.csv.sheetLabel")}
                      <select
                        value={sheetName}
                        disabled={pending}
                        onChange={(e) => parseFile(file, e.target.value)}
                        className="rounded-md border border-line bg-surface px-2 py-1 text-sm text-ink focus:border-teal"
                      >
                        {sheetNames.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={reset}
                    className="text-sm font-medium text-teal hover:underline"
                  >
                    {t("onboarding.csv.reset")}
                  </button>
                </span>
              </div>

              {/* Step 2: column mapping */}
              <section>
                <h3 className="text-sm font-semibold text-ink">
                  {t("onboarding.csv.mapTitle")}
                </h3>
                <p className="mb-3 mt-1 text-xs text-muted">
                  {t("onboarding.csv.mapHint")}
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {targets.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-ink">
                        {field.labelKey ? t(field.labelKey) : field.label}
                        {field.required && (
                          <span className="text-danger"> *</span>
                        )}
                        {/* Custom columns are marked so the operator can tell
                            them apart from the built-in roster fields. */}
                        {!field.labelKey && (
                          <span className="ml-1 rounded bg-lavender px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-primary">
                            {t("onboarding.csv.customTag")}
                          </span>
                        )}
                      </span>
                      <select
                        value={mapping[field.key] ?? ""}
                        onChange={(e) =>
                          setMapping((m) => ({
                            ...m,
                            [field.key]: e.target.value || undefined,
                          }))
                        }
                        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
                      >
                        <option value="">{t("onboarding.csv.ignore")}</option>
                        {headers.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
              </section>

              {/* Step 2b: fee columns -> ledger (feeWrites only) */}
              {canPostFees && (
                <section className="rounded-md border border-line bg-canvas p-4">
                  <h3 className="text-sm font-semibold text-ink">
                    {t("onboarding.csv.feesTitle")}
                  </h3>
                  <p className="mb-3 mt-1 text-xs text-muted">
                    {t("onboarding.csv.feesHint")}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {FEE_TARGETS.map((field) => (
                      <label key={field.key} className="block">
                        <span className="mb-1 block text-xs font-medium text-ink">
                          {t(field.labelKey!)}
                          <span
                            className={`ml-1 rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                              field.category.side === "charge"
                                ? "bg-lavender text-danger"
                                : "bg-mint text-teal"
                            }`}
                          >
                            {field.category.side === "charge"
                              ? t("onboarding.csv.feeCharge")
                              : t("onboarding.csv.feeCredit")}
                          </span>
                        </span>
                        <select
                          value={mapping[field.key] ?? ""}
                          onChange={(e) =>
                            setMapping((m) => ({
                              ...m,
                              [field.key]: e.target.value || undefined,
                            }))
                          }
                          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
                        >
                          <option value="">{t("onboarding.csv.ignore")}</option>
                          {headers.map((h) => (
                            <option key={h} value={h}>
                              {h}
                            </option>
                          ))}
                        </select>
                      </label>
                    ))}
                  </div>

                  {mappedFeeTargets.length > 0 && (
                    <div className="mt-4 flex flex-col gap-3 border-t border-line pt-4">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-ink">
                            {t("onboarding.csv.feeDate")}
                            <span className="text-danger"> *</span>
                          </span>
                          <input
                            type="date"
                            value={feeDate}
                            onChange={(e) => setFeeDate(e.target.value)}
                            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
                          />
                        </label>
                        <label className="block">
                          <span className="mb-1 block text-xs font-medium text-ink">
                            {t("onboarding.csv.feeNote")}
                          </span>
                          <input
                            type="text"
                            maxLength={120}
                            value={feeNote}
                            placeholder={t("onboarding.csv.feeNotePlaceholder")}
                            onChange={(e) => setFeeNote(e.target.value)}
                            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
                          />
                        </label>
                      </div>

                      {tuitionAndScholarshipMapped && (
                        <label className="flex items-start gap-2 text-xs text-ink">
                          <input
                            type="checkbox"
                            checked={scholarshipOnTop}
                            onChange={(e) => setScholarshipOnTop(e.target.checked)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="font-medium">
                              {t("onboarding.csv.scholarshipOnTop")}
                            </span>
                            <span className="block text-muted">
                              {t("onboarding.csv.scholarshipOnTopHint")}
                            </span>
                          </span>
                        </label>
                      )}

                    </div>
                  )}
                </section>
              )}

              {/* Existing students: update instead of skipping as duplicates. */}
              <label className="flex items-start gap-2 rounded-md border border-line px-4 py-3 text-xs text-ink">
                <input
                  type="checkbox"
                  checked={updateExisting}
                  onChange={(e) => setUpdateExisting(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium">
                    {t("onboarding.csv.updateExisting")}
                  </span>
                  <span className="block text-muted">
                    {t("onboarding.csv.updateExistingHint")}
                  </span>
                </span>
              </label>

              {/* Rows the server refused on the last import attempt, and any
                  cell it had to leave blank. Both name the column and quote the
                  raw text, because "3 rows failed" is not something an operator
                  can act on. */}
              {((failures && failures.length > 0) ||
                serverCellIssues.length > 0) && (
                <section className="rounded-md border border-danger/40 bg-lavender/40 p-3">
                  {failures && failures.length > 0 && (
                    <>
                      <h3 className="mb-2 text-sm font-semibold text-danger">
                        {t("onboarding.csv.failuresTitle", {
                          count: failures.length,
                        })}
                      </h3>
                      <ul className="mb-3 max-h-40 overflow-auto text-xs text-ink">
                        {failures.map((f) => (
                          <li key={f.row}>
                            {t("onboarding.csv.rowLabel")} {f.row}:{" "}
                            {f.reason === "unreadableDate"
                              ? t("onboarding.errors.unreadableDate", {
                                  column: f.column ?? "",
                                  raw: f.raw ? `"${f.raw}"` : "—",
                                })
                              : t(`onboarding.errors.${f.reason}`)}
                            {f.reason !== "unreadableDate" && f.detail
                              ? ` (${f.detail})`
                              : ""}
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                  {serverCellIssues.length > 0 && (
                    <>
                      <h3 className="mb-1 text-sm font-semibold text-danger">
                        {t("onboarding.csv.cellIssuesTitle")}
                      </h3>
                      <ul className="max-h-40 overflow-auto text-xs text-ink">
                        {serverCellIssues.map((issue, i) => (
                          <li key={`${issue.row}-${issue.column}-${i}`}>
                            {t("onboarding.csv.rowLabel")} {issue.row} —{" "}
                            {issue.column}: &quot;{issue.raw}&quot;
                          </li>
                        ))}
                      </ul>
                    </>
                  )}
                </section>
              )}

              {/* Step 3: preview — what will actually be stored */}
              <section>
                <div className="mb-2 flex flex-wrap items-center gap-3">
                  <h3 className="text-sm font-semibold text-ink">
                    {t("onboarding.csv.previewTitle")}
                  </h3>
                  <span className="rounded-full bg-mint px-2 py-0.5 text-xs font-medium text-teal">
                    {t("onboarding.csv.validRows", {
                      count: validRows.length,
                    })}
                  </span>
                  {invalidCount > 0 && (
                    <span className="rounded-full bg-lavender px-2 py-0.5 text-xs font-medium text-danger">
                      {t("onboarding.csv.invalidRows", { count: invalidCount })}
                    </span>
                  )}
                </div>
                <p className="mb-3 text-xs text-muted">
                  {t("onboarding.csv.previewHint", { count: PREVIEW_ROWS })}
                </p>

                {/* WHICH ROWS will be skipped. Named by row number and
                    reason, because the offending row is usually outside the
                    ten the table shows. */}
                {rowIssueSummary.length > 0 && (
                  <div className="mb-3 rounded-md border border-danger/40 bg-lavender/40 p-3">
                    <h4 className="text-sm font-semibold text-danger">
                      {invalidCount === 1
                        ? t("onboarding.csv.rowIssuesTitleOne")
                        : t("onboarding.csv.rowIssuesTitle", {
                            count: invalidCount,
                          })}
                    </h4>
                    <ul className="mt-1 text-xs text-ink">
                      {rowIssueSummary.map((entry) => (
                        <li key={entry.reason}>
                          {t(
                            entry.rowNumbers.length === 1
                              ? "onboarding.csv.rowIssueLineOne"
                              : "onboarding.csv.rowIssueLine",
                            {
                              reason: t(`onboarding.errors.${entry.reason}`),
                              rows: entry.rowNumbers.slice(0, 12).join(", "),
                              more:
                                entry.rowNumbers.length > 12
                                  ? ` +${entry.rowNumbers.length - 12}`
                                  : "",
                            },
                          )}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted">
                      {t("onboarding.csv.rowIssuesHint")}
                    </p>
                  </div>
                )}

                {/* PER-COLUMN failure summary. This is the report the operator
                    acts on: which column, how many rows, and what the offending
                    cells actually say. */}
                {cellIssueSummary.length > 0 && (
                  <div className="mb-3 rounded-md border border-danger/40 bg-lavender/40 p-3">
                    <h4 className="text-sm font-semibold text-danger">
                      {t("onboarding.csv.cellIssuesTitle")}
                    </h4>
                    <ul className="mt-1 text-xs text-ink">
                      {cellIssueSummary.map((entry) => (
                        <li key={entry.column}>
                          {t("onboarding.csv.cellIssueLine", {
                            count: entry.count,
                            column: entry.column,
                            raw: entry.samples
                              .map((x) => `"${x}"`)
                              .join(", "),
                          })}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-xs text-muted">
                      {t("onboarding.csv.cellIssuesHint")}
                    </p>
                    <label className="mt-3 flex items-start gap-2 text-xs text-ink">
                      <input
                        type="checkbox"
                        checked={allowBlankDates}
                        onChange={(e) => setAllowBlankDates(e.target.checked)}
                        className="mt-0.5"
                      />
                      <span>
                        <span className="font-medium">
                          {t("onboarding.csv.allowBlankDates")}
                        </span>
                        <span className="block text-muted">
                          {t("onboarding.csv.allowBlankDatesHint")}
                        </span>
                      </span>
                    </label>
                  </div>
                )}

                <div className="dt-scroll max-h-72 rounded-md border border-line">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="sticky top-0 bg-canvas text-muted">
                      <tr className="border-b border-line">
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.rowLabel")}
                        </th>
                        {/* Status sits SECOND, not last: the table scrolls
                            sideways, and a verdict the operator has to scroll
                            to find is a verdict they never see. */}
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.statusOk")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.fieldFullName")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.fieldRollNo")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.fieldEmail")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.fieldCourse")}
                        </th>
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.fieldYear")}
                        </th>
                        {/* One column per mapped field whose value is
                            transformed on the way in — each shows the STORED
                            value, not the raw cell. */}
                        {resolvedColumns.map((column) => (
                          <th
                            key={column.key}
                            className="whitespace-nowrap px-3 py-2 font-medium"
                            title={`${column.label} — ${t("onboarding.csv.colWillSave")}`}
                          >
                            {column.label}
                          </th>
                        ))}
                        {mappedFeeTargets.length > 0 && (
                          <th className="px-3 py-2 text-right font-medium">
                            {t("onboarding.csv.fieldFeeBalance")}
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {visibleRows.map((row, i) => {
                        const err = validations[i];
                        return (
                          <tr
                            key={i}
                            className={`border-b border-line last:border-0 ${
                              err ? "bg-lavender/40" : ""
                            }`}
                          >
                            <td className="px-3 py-1.5 text-muted">{i + 1}</td>
                            <td className="whitespace-nowrap px-3 py-1.5">
                              {err ? (
                                <span className="font-medium text-danger">
                                  {t(`onboarding.errors.${err}`)}
                                </span>
                              ) : (
                                <span className="text-teal">
                                  {t("onboarding.csv.statusReady")}
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-ink">
                              {row.fullName || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-muted">
                              {row.studentId || "—"}
                            </td>
                            <td className="px-3 py-1.5 text-muted">
                              {row.email || "—"}
                            </td>
                            <td className="px-3 py-1.5">
                              {err === "invalidCourse" ? (
                                <span className="text-danger">
                                  {row.course}
                                </span>
                              ) : resolvedCourses[i] ? (
                                <span className="text-ink">
                                  {resolvedCourses[i]}
                                </span>
                              ) : (
                                <span className="text-muted">—</span>
                              )}
                            </td>
                            <td className="px-3 py-1.5 text-muted">
                              {resolvedYears[i] || "—"}
                            </td>
                            {resolvedCells[i]?.map((cell, c) => (
                              <td
                                key={resolvedColumns[c].key}
                                className="whitespace-nowrap px-3 py-1.5"
                              >
                                {cell.bad ? (
                                  // The raw text is shown, not hidden behind a
                                  // generic error: the operator needs to see
                                  // "45231" to understand what to fix.
                                  <span
                                    className="font-medium text-danger"
                                    title={t("onboarding.csv.unreadable")}
                                  >
                                    {cell.raw}
                                  </span>
                                ) : cell.saved ? (
                                  <span className="text-ink [font-variant-numeric:tabular-nums]">
                                    {cell.saved}
                                  </span>
                                ) : (
                                  <span className="text-muted">—</span>
                                )}
                              </td>
                            ))}
                            {mappedFeeTargets.length > 0 && (
                              <FeeBalanceCell result={feeResults[i]} />
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* ~10 rows by default. A 2000-row scroll box is not a check
                    anyone performs; ten rows is. The rest is one click away. */}
                <div className="mt-2 flex flex-wrap items-center gap-3">
                  <p className="text-xs text-muted">
                    {t("onboarding.csv.previewNote", {
                      shown: visibleRows.length,
                      total: mapped.length,
                    })}
                  </p>
                  {mapped.length > PREVIEW_ROWS && (
                    <button
                      type="button"
                      onClick={() => setShowAllRows((open) => !open)}
                      className="cursor-pointer text-xs font-medium text-teal underline-offset-2 hover:underline"
                    >
                      {showAllRows
                        ? t("onboarding.csv.previewShowFewer", {
                            count: PREVIEW_ROWS,
                          })
                        : t("onboarding.csv.previewShowAll", {
                            count: mapped.length,
                          })}
                    </button>
                  )}
                </div>
              </section>
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            onClick={doImport}
            disabled={
              pending ||
              validRows.length === 0 ||
              (mappedFeeTargets.length > 0 && !feeDate)
            }
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {pending
              ? t("onboarding.csv.importing")
              : t("onboarding.csv.import", { count: validRows.length })}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Net ledger effect of one row (paid − charged): negative = still owes. The
 * tooltip lists the individual entries that will be posted.
 */
function FeeBalanceCell({
  result,
}: {
  result: ReturnType<typeof buildFeeLines> | undefined;
}) {
  const t = useT();
  if (!result || !result.ok) {
    return <td className="px-3 py-1.5 text-right text-danger">—</td>;
  }
  if (result.lines.length === 0) {
    return <td className="px-3 py-1.5 text-right text-muted">—</td>;
  }
  const balance = feeLinesBalance(result.lines);
  const detail = result.lines
    .map(
      (l) =>
        `${t(l.category.labelKey)}: ${l.type === "charge" ? "" : "−"}${formatCurrency(l.amount)}`,
    )
    .join("\n");
  return (
    <td
      title={detail}
      className={`px-3 py-1.5 text-right tabular-nums ${balanceToneClass(balance)}`}
    >
      {formatCurrency(balance)}
    </td>
  );
}
