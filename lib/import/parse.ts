// Server-side spreadsheet parsing for the student import.
//
// EVERY check here runs on the SERVER. The browser's parse is only ever used to
// render a preview; the rows that reach the database come from re-parsing the
// uploaded file here. A client-parsed payload is attacker-controlled data with
// a friendly shape, and is never trusted.
//
// Order of operations matters — cheap rejections come first so a hostile upload
// is refused before it costs anything:
//   1. size        — checked from file.size, BEFORE any bytes are read
//   2. type        — magic bytes, not the filename extension
//   3. row cap     — bounded while parsing, not after
//   4. cell cap    — bounded per cell, so one giant cell cannot exhaust memory
//   5. formula     — neutralized before the value can reach the DB or an export
//
// XLSX is read with a purpose-built reader over `fflate` rather than a
// full-featured spreadsheet library. That was a security choice: the popular
// options either carry known CVEs (the npm `xlsx` package is pinned at 0.18.5
// with prototype-pollution and ReDoS advisories) or drag in a transitive
// dependency tree of their own. fflate has zero dependencies and no advisories,
// and reading a roster needs only cell text.

import Papa from "papaparse";
import { unzipSync } from "fflate";

// ---------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------
export const IMPORT_LIMITS = {
  /** Hard ceiling on the uploaded file. Checked before reading any bytes. */
  maxFileBytes: 5 * 1024 * 1024, // 5 MB
  /** Data rows accepted from one file (excludes the header row). */
  maxRows: 2000,
  /** Characters accepted in any single cell. */
  maxCellLength: 500,
  /** Columns accepted. Bounds a file with a pathological header row. */
  maxColumns: 64,
  /**
   * Ceiling on TOTAL uncompressed bytes extracted from an .xlsx archive.
   * An xlsx is a zip, so this is the zip-bomb guard: a 200 KB upload that
   * inflates to gigabytes is refused instead of being decompressed.
   */
  maxUnzippedBytes: 60 * 1024 * 1024, // 60 MB
} as const;

export type ImportRejection =
  | "tooLarge"
  | "emptyFile"
  | "unsupportedType"
  | "legacyXls"
  | "tooManyRows"
  | "tooManyColumns"
  | "cellTooLong"
  | "noRows"
  | "noHeaders"
  | "corruptFile";

export type ParsedSheet = {
  headers: string[];
  rows: Record<string, string>[];
  /** Worksheet the rows came from. Undefined for a CSV, which has only one. */
  sheetName?: string;
  /** Every worksheet in the workbook, in TAB order. Lets the operator switch. */
  sheetNames?: string[];
};

export type ParseOutcome =
  | { ok: true; sheet: ParsedSheet }
  | { ok: false; reason: ImportRejection };

// ---------------------------------------------------------------------------
// 5. CSV formula injection
// ---------------------------------------------------------------------------

/**
 * Characters that make a spreadsheet treat a cell as a FORMULA rather than
 * text. A cell like `=cmd|'/c calc'!A1` or `@SUM(1+1)*cmd` executes when the
 * exported file is opened in Excel / LibreOffice / Sheets — the classic CSV
 * injection chain. Tab and carriage return are included because Excel strips
 * leading whitespace before deciding, so `\t=1+1` is still a formula.
 */
const FORMULA_TRIGGERS = ["=", "+", "-", "@", "\t", "\r"];

/**
 * Neutralize a cell by prefixing a single quote, which every major spreadsheet
 * reads as "the rest of this cell is literal text". Applied on the way IN, so
 * the stored value is inert whether it is later rendered in the portal or
 * re-exported to a file someone opens in Excel.
 *
 * KNOWN SIDE EFFECT, called out deliberately: an international phone number
 * typed as `+919876543210` begins with `+` and is therefore stored as
 * `'+919876543210`. That is the standard OWASP mitigation and it is visible to
 * users. See the Phase 4 report for the narrower alternative.
 */
export function neutralizeFormula(value: string): string {
  if (!value) return value;
  return FORMULA_TRIGGERS.includes(value[0]) ? `'${value}` : value;
}

/** Trim, bound, and neutralize one cell. Returns null if it is over-long. */
function sanitizeCell(raw: unknown): string | null {
  const text = typeof raw === "string" ? raw : String(raw ?? "");
  // Strip control characters that could corrupt later rendering or exports,
  // keeping tab/newline out of the stored value entirely for roster fields.
  const cleaned = text
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .trim();
  if (cleaned.length > IMPORT_LIMITS.maxCellLength) return null;
  return neutralizeFormula(cleaned);
}

// ---------------------------------------------------------------------------
// 2. File type detection by magic bytes
// ---------------------------------------------------------------------------

export type DetectedType = "csv" | "xlsx" | "xls" | "unknown";

/**
 * Identify a file by its CONTENT, not its name. `roster.csv` can hold anything;
 * an extension is a claim by the uploader, not evidence.
 *
 *   xlsx -> a ZIP container: 50 4B 03 04 ("PK\x03\x04")
 *   xls  -> legacy OLE2 compound file: D0 CF 11 E0 A1 B1 1A E1
 *   csv  -> no signature, so it is identified by ELIMINATION: it must decode as
 *           text and contain no NUL bytes (which is what separates it from an
 *           arbitrary binary renamed to .csv).
 */
export function detectType(bytes: Uint8Array): DetectedType {
  if (bytes.length >= 4) {
    if (
      bytes[0] === 0x50 &&
      bytes[1] === 0x4b &&
      (bytes[2] === 0x03 || bytes[2] === 0x05 || bytes[2] === 0x07)
    ) {
      return "xlsx";
    }
    if (
      bytes[0] === 0xd0 &&
      bytes[1] === 0xcf &&
      bytes[2] === 0x11 &&
      bytes[3] === 0xe0
    ) {
      return "xls";
    }
  }

  // Any NUL byte in the first 8 KB means this is binary, not a CSV.
  const probe = bytes.subarray(0, 8192);
  if (probe.includes(0)) return "unknown";

  // Must be decodable as UTF-8. `fatal: true` throws on invalid sequences,
  // which rules out arbitrary binary that happens to avoid NUL.
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(probe);
    return "csv";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function parseCsv(text: string): ParseOutcome {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: true,
    // Cap the parse itself: papaparse stops after this many data rows, so a
    // million-row file is bounded DURING parsing rather than after.
    preview: IMPORT_LIMITS.maxRows + 1,
  });

  const headers = (result.meta.fields ?? [])
    .map((h) => (typeof h === "string" ? h.trim() : ""))
    .filter(Boolean);
  if (headers.length === 0) return { ok: false, reason: "noHeaders" };
  if (headers.length > IMPORT_LIMITS.maxColumns) {
    return { ok: false, reason: "tooManyColumns" };
  }
  if (result.data.length > IMPORT_LIMITS.maxRows) {
    return { ok: false, reason: "tooManyRows" };
  }

  const rows: Record<string, string>[] = [];
  for (const raw of result.data) {
    const row: Record<string, string> = {};
    let hasValue = false;
    for (const header of headers) {
      const cell = sanitizeCell(raw[header]);
      if (cell === null) return { ok: false, reason: "cellTooLong" };
      row[header] = cell;
      if (cell) hasValue = true;
    }
    // Skip rows that are entirely blank after sanitizing.
    if (hasValue) rows.push(row);
  }

  if (rows.length === 0) return { ok: false, reason: "noRows" };
  return { ok: true, sheet: { headers, rows } };
}

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

/** Decode the five XML entities that can appear in shared-string text. */
function decodeXmlEntities(text: string): string {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) =>
      String.fromCodePoint(parseInt(h, 16)),
    )
    // Ampersand LAST, so "&amp;lt;" does not become "<".
    .replace(/&amp;/g, "&");
}

/**
 * Collect the text of every <t> descendant inside one XML fragment.
 *
 * `<rPh>` runs are stripped first: they hold the PHONETIC guide for a string
 * (furigana), not the string itself, so including their <t> elements appends
 * a second copy of the text to the value.
 */
function textOf(fragment: string): string {
  const cleaned = fragment.replace(/<rPh[\s\S]*?<\/rPh>/g, "");
  let out = "";
  const re = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(cleaned)) !== null) out += m[1];
  return decodeXmlEntities(out);
}

/** "BC12" -> 54 (zero-based column index). */
function columnIndex(ref: string): number {
  const letters = ref.replace(/[0-9]/g, "");
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return index - 1;
}

/**
 * Worksheets in TAB order, with the file each one lives in.
 *
 * WHY THIS EXISTS: the parser used to read `xl/worksheets/sheet1.xml` and call
 * it the roster. That file name is an internal part number, NOT "the first
 * tab" — a workbook whose tabs have been reordered, or where the first tab was
 * deleted and re-added, stores the visible first tab as sheet3.xml just as
 * easily. So a college importing the tab they were looking at could silently
 * get a different class's columns. The mapping from tab to file lives in
 * xl/workbook.xml (order + names + hidden state) plus its .rels (name -> file),
 * which is what this reads.
 */
type SheetRef = { name: string; path: string; hidden: boolean };

function readSheetRefs(files: Record<string, Uint8Array>): SheetRef[] {
  const decoder = new TextDecoder("utf-8");
  const workbook = files["xl/workbook.xml"];
  const rels = files["xl/_rels/workbook.xml.rels"];
  if (!workbook || !rels) return [];

  // rId -> worksheet path. Targets are relative to xl/ and may be "/xl/..".
  const relXml = decoder.decode(rels);
  const byId = new Map<string, string>();
  const relRe = /<Relationship\b[^>]*>/g;
  let rel: RegExpExecArray | null;
  while ((rel = relRe.exec(relXml)) !== null) {
    const tag = rel[0];
    const id = /\bId="([^"]+)"/.exec(tag)?.[1];
    const target = /\bTarget="([^"]+)"/.exec(tag)?.[1];
    if (!id || !target) continue;
    const path = target.replace(/^\/?xl\//, "").replace(/^\.\//, "");
    byId.set(id, `xl/${path}`);
  }

  const wbXml = decoder.decode(workbook);
  const sheets: SheetRef[] = [];
  const sheetRe = /<sheet\b[^>]*\/?>/g;
  let m: RegExpExecArray | null;
  while ((m = sheetRe.exec(wbXml)) !== null) {
    const tag = m[0];
    const name = decodeXmlEntities(/\bname="([^"]*)"/.exec(tag)?.[1] ?? "");
    const rid = /\br:id="([^"]+)"/.exec(tag)?.[1] ?? /\bid="([^"]+)"/.exec(tag)?.[1];
    const path = rid ? byId.get(rid) : undefined;
    if (!name || !path) continue;
    // state="hidden" / "veryHidden" tabs are never the one the operator means.
    const hidden = /\bstate="(hidden|veryHidden)"/.test(tag);
    sheets.push({ name, path, hidden });
  }
  return sheets;
}

function parseXlsx(bytes: Uint8Array, wantedSheet?: string): ParseOutcome {
  let files: Record<string, Uint8Array>;
  try {
    let extracted = 0;
    files = unzipSync(bytes, {
      filter: (file) => {
        // ZIP-BOMB GUARD. `originalSize` comes from the archive's own directory,
        // so a lying header still cannot get past the running total below —
        // anything beyond the ceiling is simply never extracted.
        extracted += file.originalSize;
        if (extracted > IMPORT_LIMITS.maxUnzippedBytes) return false;
        // Only what a roster needs: the shared strings, the workbook index
        // (tab order + names) with its relationship map, and the worksheets
        // themselves. Everything else in the archive (macros, embedded
        // objects, external links, charts) is never even inflated.
        return (
          file.name === "xl/sharedStrings.xml" ||
          file.name === "xl/workbook.xml" ||
          file.name === "xl/_rels/workbook.xml.rels" ||
          /^xl\/worksheets\/[^/]+\.xml$/.test(file.name)
        );
      },
    });
  } catch {
    return { ok: false, reason: "corruptFile" };
  }

  // WHICH TAB. The caller's choice wins (the import dialog offers a picker);
  // otherwise the first tab that is not hidden — which is the one a person
  // opening the workbook sees. Falling back to sheet1.xml keeps files whose
  // workbook index we could not read working exactly as before.
  const refs = readSheetRefs(files).filter((r) => files[r.path]);
  const visible = refs.filter((r) => !r.hidden);
  const chosen =
    (wantedSheet
      ? refs.find((r) => r.name === wantedSheet)
      : undefined) ??
    visible[0] ??
    refs[0];

  const sheetBytes = chosen
    ? files[chosen.path]
    : files["xl/worksheets/sheet1.xml"];
  if (!sheetBytes) return { ok: false, reason: "corruptFile" };
  const sheetNames = visible.length > 0 ? visible.map((r) => r.name) : undefined;

  const decoder = new TextDecoder("utf-8");
  const sheetXml = decoder.decode(sheetBytes);

  // Shared strings: xlsx stores repeated text once and references it by index,
  // so EVERY <si> must be counted — cells reference them by POSITION.
  //
  // `<si/>` (an empty string) is written self-closing, and the old pattern only
  // matched the `<si>…</si>` form. Skipping one shifts every later index by
  // one, which shows up as text from the neighbouring cell — or a blank where
  // a value plainly exists in Excel. The alternation below matches both forms.
  const shared: string[] = [];
  const sharedBytes = files["xl/sharedStrings.xml"];
  if (sharedBytes) {
    const xml = decoder.decode(sharedBytes);
    const re = /<si>([\s\S]*?)<\/si>|<si\s*\/>/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(xml)) !== null) shared.push(m[1] ? textOf(m[1]) : "");
  }

  // Walk the rows. Bounded as we go, so a 500 000-row sheet stops at the cap.
  const grid: string[][] = [];
  const rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch: RegExpExecArray | null;
  while ((rowMatch = rowRe.exec(sheetXml)) !== null) {
    // +1 for the header row.
    if (grid.length > IMPORT_LIMITS.maxRows + 1) {
      return { ok: false, reason: "tooManyRows" };
    }
    const cells: string[] = [];
    const cellRe = /<c([^>]*)>([\s\S]*?)<\/c>|<c([^>]*)\/>/g;
    let cellMatch: RegExpExecArray | null;
    while ((cellMatch = cellRe.exec(rowMatch[1])) !== null) {
      const attrs = cellMatch[1] ?? cellMatch[3] ?? "";
      const body = cellMatch[2] ?? "";
      const refMatch = /r="([A-Z]+\d+)"/.exec(attrs);
      const at = refMatch ? columnIndex(refMatch[1]) : cells.length;
      if (at < 0 || at >= IMPORT_LIMITS.maxColumns) {
        return { ok: false, reason: "tooManyColumns" };
      }

      const typeMatch = /t="([^"]+)"/.exec(attrs);
      const type = typeMatch?.[1];
      let value: string;
      if (type === "s") {
        // Shared-string reference.
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = shared[Number(vMatch?.[1] ?? -1)] ?? "";
      } else if (type === "inlineStr") {
        value = textOf(body);
      } else {
        const vMatch = /<v>([\s\S]*?)<\/v>/.exec(body);
        value = decodeXmlEntities(vMatch?.[1] ?? "");
      }

      while (cells.length < at) cells.push("");
      cells[at] = value;
    }
    grid.push(cells);
  }

  if (grid.length === 0) return { ok: false, reason: "noRows" };

  const headerRow = grid[0];
  const headers: string[] = [];
  const headerIndexes: number[] = [];
  headerRow.forEach((cell, i) => {
    const name = (cell ?? "").trim();
    if (name) {
      headers.push(name);
      headerIndexes.push(i);
    }
  });
  if (headers.length === 0) return { ok: false, reason: "noHeaders" };

  const rows: Record<string, string>[] = [];
  for (const line of grid.slice(1)) {
    const row: Record<string, string> = {};
    let hasValue = false;
    for (let h = 0; h < headers.length; h++) {
      const cell = sanitizeCell(line[headerIndexes[h]] ?? "");
      if (cell === null) return { ok: false, reason: "cellTooLong" };
      row[headers[h]] = cell;
      if (cell) hasValue = true;
    }
    if (hasValue) rows.push(row);
    if (rows.length > IMPORT_LIMITS.maxRows) {
      return { ok: false, reason: "tooManyRows" };
    }
  }

  if (rows.length === 0) return { ok: false, reason: "noRows" };
  return {
    ok: true,
    sheet: { headers, rows, sheetName: chosen?.name, sheetNames },
  };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Parse an uploaded roster. The single server-side gate every import passes
 * through — both the preview step and the authoritative import call it, so the
 * two can never disagree about what the file contains.
 */
export async function parseImportFile(
  file: File,
  /** Worksheet (tab) to read. Ignored for CSV. Defaults to the first visible. */
  sheetName?: string,
): Promise<ParseOutcome> {
  // 1. SIZE, from the multipart metadata — before a single byte is read into
  //    memory, which is the whole point of checking it here rather than after.
  if (file.size > IMPORT_LIMITS.maxFileBytes) {
    return { ok: false, reason: "tooLarge" };
  }
  if (file.size === 0) return { ok: false, reason: "emptyFile" };

  const bytes = new Uint8Array(await file.arrayBuffer());

  // Re-check post-read: `file.size` is metadata and a crafted request could
  // understate it.
  if (bytes.byteLength > IMPORT_LIMITS.maxFileBytes) {
    return { ok: false, reason: "tooLarge" };
  }

  // 2. TYPE by content, ignoring the filename entirely.
  const type = detectType(bytes);
  if (type === "xls") return { ok: false, reason: "legacyXls" };
  if (type === "xlsx") return parseXlsx(bytes, sheetName);
  if (type === "csv") {
    try {
      return parseCsv(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return { ok: false, reason: "unsupportedType" };
    }
  }
  return { ok: false, reason: "unsupportedType" };
}
