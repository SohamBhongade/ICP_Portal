"use client";

// Bulk student import — drag-and-drop CSV, then a column-mapping step, then a
// validated preview before anything is written.
//
// Flow:
//   1. Drop / pick a .csv -> papaparse (header mode) gives headers + rows.
//   2. Map each portal field to a CSV header (auto-guessed, admin can adjust).
//   3. Live validation flags malformed emails / missing mandatory fields.
//   4. Only the valid rows are sent to bulkImportStudentsAction.

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileUp, X } from "lucide-react";
import Papa from "papaparse";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  bulkImportStudentsAction,
  type ActionError,
  type CsvStudentRow,
} from "@/app/actions/onboarding";
import { extractYear, normalizeCourse, resolveCourse } from "@/lib/courses";
import type { ToastKind } from "./UsersContent";

type TargetField = keyof CsvStudentRow;

// Portal fields in display order. `required` drives mandatory-field validation;
// `guesses` are substrings used to auto-match a CSV header to this field.
const FIELDS: {
  key: TargetField;
  labelKey: string;
  required: boolean;
  guesses: string[];
}[] = [
  { key: "fullName", labelKey: "onboarding.csv.fieldFullName", required: true, guesses: ["fullname", "name", "studentname"] },
  { key: "studentId", labelKey: "onboarding.csv.fieldRollNo", required: true, guesses: ["roll", "rollno", "rollnumber", "studentid", "id"] },
  { key: "email", labelKey: "onboarding.csv.fieldEmail", required: false, guesses: ["email", "mail"] },
  { key: "phone", labelKey: "onboarding.csv.fieldPhone", required: false, guesses: ["phone", "mobile", "contact"] },
  { key: "course", labelKey: "onboarding.csv.fieldCourse", required: false, guesses: ["course", "program"] },
  { key: "className", labelKey: "onboarding.csv.fieldClass", required: false, guesses: ["class", "year"] },
  { key: "practicalBatch", labelKey: "onboarding.csv.fieldBatch", required: false, guesses: ["batch", "practical"] },
];

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type RawRow = Record<string, string>;
type Mapping = Partial<Record<TargetField, string>>;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function guessMapping(headers: string[]): Mapping {
  const map: Mapping = {};
  const used = new Set<string>();
  for (const field of FIELDS) {
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

  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [mapping, setMapping] = useState<Mapping>({});
  const [dragging, setDragging] = useState(false);

  const parseFile = (file: File) => {
    Papa.parse<RawRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const fields = res.meta.fields ?? [];
        setHeaders(fields);
        setRows(res.data);
        setMapping(guessMapping(fields));
        setFileName(file.name);
      },
    });
  };

  const onFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (file) parseFile(file);
  };

  // Map each raw row to our schema shape using the current column mapping.
  const mapped: CsvStudentRow[] = useMemo(() => {
    return rows.map((r) => {
      const get = (k: TargetField) => {
        const h = mapping[k];
        return h ? (r[h] ?? "").trim() : "";
      };
      return {
        fullName: get("fullName"),
        studentId: get("studentId"),
        email: get("email") || undefined,
        phone: get("phone") || undefined,
        course: get("course") || undefined,
        className: get("className") || undefined,
        practicalBatch: get("practicalBatch") || undefined,
      };
    });
  }, [rows, mapping]);

  // Per-row client validation -> error code (or null = ready). Mirrors the
  // authoritative server checks so the preview never disagrees with the import.
  const validations: (ActionError | null)[] = useMemo(() => {
    return mapped.map((row) => {
      if (!row.fullName) return "missingName";
      if (!row.studentId) return "missingRollNo";
      if (row.email && !EMAIL_RE.test(row.email)) return "invalidEmail";
      if (resolveCourse(row.course).status === "invalid") return "invalidCourse";
      return null;
    });
  }, [mapped]);

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
  const invalidCount = rows.length - validRows.length;

  const reset = () => {
    setFileName(null);
    setHeaders([]);
    setRows([]);
    setMapping({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const doImport = () => {
    if (validRows.length === 0) return;
    startTransition(async () => {
      const result = await bulkImportStudentsAction(validRows);
      if (!result.ok) {
        notify("error", t("onboarding.toast.importFailed"));
        return;
      }
      if (result.failed.length > 0) {
        notify(
          "success",
          t("onboarding.toast.importedWithErrors", {
            created: result.created,
            failed: result.failed.length,
          }),
        );
      } else {
        notify(
          "success",
          t("onboarding.toast.imported", { created: result.created }),
        );
      }
      router.refresh();
      onClose();
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto p-4">
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
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => onFiles(e.target.files)}
              />
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-md border border-line bg-canvas px-3 py-2 text-sm">
                <span className="text-ink">
                  {t("onboarding.csv.fileSelected", {
                    name: fileName,
                    count: rows.length,
                  })}
                </span>
                <button
                  type="button"
                  onClick={reset}
                  className="text-sm font-medium text-teal hover:underline"
                >
                  {t("onboarding.csv.reset")}
                </button>
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
                  {FIELDS.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-medium text-ink">
                        {t(field.labelKey)}
                        {field.required && (
                          <span className="text-danger"> *</span>
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

              {/* Step 3: preview + validation */}
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

                <div className="max-h-64 overflow-auto rounded-md border border-line">
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead className="sticky top-0 bg-canvas text-muted">
                      <tr className="border-b border-line">
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.rowLabel")}
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
                        <th className="px-3 py-2 font-medium">
                          {t("onboarding.csv.statusOk")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {mapped.map((row, i) => {
                        const err = validations[i];
                        return (
                          <tr
                            key={i}
                            className="border-b border-line last:border-0"
                          >
                            <td className="px-3 py-1.5 text-muted">{i + 1}</td>
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
                            <td className="px-3 py-1.5">
                              {err ? (
                                <span className="text-danger">
                                  {t(`onboarding.errors.${err}`)}
                                </span>
                              ) : (
                                <span className="text-teal">
                                  {t("onboarding.csv.statusOk")}
                                </span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
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
            disabled={pending || validRows.length === 0}
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
