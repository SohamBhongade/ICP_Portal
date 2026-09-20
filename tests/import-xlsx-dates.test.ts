// End-to-end regression test for the reported bug:
//
//   "when I upload an XLSX and correctly map the D.O.B, Year of Admission and
//    Year of Leaving columns, those values come through blank"
//
// This builds a real .xlsx in memory — a zip containing the same worksheet XML
// Excel writes, with DATE-FORMATTED CELLS STORED AS SERIAL NUMBERS, which is
// exactly what the app's reader sees and what nothing downstream used to
// understand — parses it through the production reader, and then applies the
// production coercion the import applies.
//
// The assertion that matters is the last one in each case: the value is NOT
// blank. Before the fix it was, with no error anywhere.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";
import { strToU8, zipSync } from "fflate";

import { parseImportFile } from "../lib/import/parse";
import { coerceFieldValue, type CustomField } from "../lib/user-fields";
import { readAdmissionYear } from "../lib/academic-year";

// The live columns from this installation, after db:migrate-field-year-type.
const DOB: CustomField = {
  id: 4,
  key: "d_o_b",
  label: "D.O.B",
  type: "date",
  options: null,
  sortOrder: 3,
};
const YEAR_OF_LEAVING: CustomField = {
  id: 1,
  key: "year_of_leaving",
  label: "Year of Leaving",
  type: "year",
  options: null,
  sortOrder: 0,
};
const CASTE: CustomField = {
  id: 3,
  key: "caste",
  label: "Caste",
  type: "text",
  options: null,
  sortOrder: 2,
};

/** One worksheet cell. `kind` mirrors the xlsx `t` attribute we care about. */
type Cell = { text: string } | { number: number };

const COLUMNS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Write a minimal but genuine .xlsx.
 *
 * Text goes in inline strings and numbers in bare <v>, which is precisely how a
 * date-formatted cell reaches us: Excel stores 45231, and the "01/11/2023" the
 * user sees is a display format held in styles.xml that our reader — by design,
 * see lib/import/parse.ts — never loads.
 */
function buildXlsx(rows: Cell[][]): File {
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${COLUMNS[c]}${r + 1}`;
          return "number" in cell
            ? `<c r="${ref}"><v>${cell.number}</v></c>`
            : `<c r="${ref}" t="inlineStr"><is><t>${cell.text}</t></is></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");

  const sheet =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${sheetRows}</sheetData></worksheet>`;

  const zipped = zipSync({
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`,
    ),
    "xl/worksheets/sheet1.xml": strToU8(sheet),
  });

  // The reader identifies the file by magic bytes (PK\x03\x04), never by name.
  return new File([zipped as BlobPart], "roster.xlsx");
}

const HEADERS: Cell[] = [
  { text: "Name" },
  { text: "Roll No" },
  { text: "Caste" },
  { text: "D.O.B" },
  { text: "Year of admission" },
  { text: "Year of Leaving" },
];

describe("XLSX import — the columns that used to arrive blank", () => {
  it("reads a date-formatted cell, which the sheet stores as a serial", async () => {
    const file = buildXlsx([
      HEADERS,
      [
        { text: "Riya Sharma" },
        { text: "STU0042" },
        { text: "OBC" },
        { number: 34865 }, // 15 June 1995, as Excel stores it
        { number: 2021 },
        { number: 2025 },
      ],
    ]);

    const parsed = await parseImportFile(file);
    strictEqual(parsed.ok, true);
    if (!parsed.ok) return;

    const row = parsed.sheet.rows[0];

    // What the reader actually hands the importer — the raw serial. This is
    // the fact the old code was not written for.
    strictEqual(row["D.O.B"], "34865");

    // And what the importer now stores.
    deepStrictEqual(coerceFieldValue(DOB, row["D.O.B"]), {
      ok: true,
      value: "1995-06-15",
    });
    deepStrictEqual(coerceFieldValue(YEAR_OF_LEAVING, row["Year of Leaving"]), {
      ok: true,
      value: "2025",
    });
    deepStrictEqual(readAdmissionYear(row["Year of admission"]), {
      ok: true,
      value: 2021,
    });
    // Caste always worked — it is a text column with no parse step. Kept here
    // so the test documents the contrast the bug report described.
    deepStrictEqual(coerceFieldValue(CASTE, row["Caste"]), {
      ok: true,
      value: "OBC",
    });
  });

  it("reads dates typed as text, day-first, and academic year strings", async () => {
    const file = buildXlsx([
      HEADERS,
      [
        { text: "Arjun Patil" },
        { text: "STU0043" },
        { text: "Open" },
        { text: "03/04/2005" },
        { text: "2024-25" },
        { text: "2028/2029" },
      ],
    ]);

    const parsed = await parseImportFile(file);
    strictEqual(parsed.ok, true);
    if (!parsed.ok) return;
    const row = parsed.sheet.rows[0];

    // 3 April, not 4 March — day-first, as Indian staff type it.
    deepStrictEqual(coerceFieldValue(DOB, row["D.O.B"]), {
      ok: true,
      value: "2005-04-03",
    });
    deepStrictEqual(readAdmissionYear(row["Year of admission"]), {
      ok: true,
      value: 2024,
    });
    deepStrictEqual(coerceFieldValue(YEAR_OF_LEAVING, row["Year of Leaving"]), {
      ok: true,
      value: "2028",
    });
  });

  it("REPORTS an unreadable cell instead of dropping it", async () => {
    const file = buildXlsx([
      HEADERS,
      [
        { text: "Sneha Kale" },
        { text: "STU0044" },
        { text: "SC" },
        { text: "not a date" },
        { text: "2024" },
        { text: "n/a" },
      ],
    ]);

    const parsed = await parseImportFile(file);
    strictEqual(parsed.ok, true);
    if (!parsed.ok) return;
    const row = parsed.sheet.rows[0];

    const dob = coerceFieldValue(DOB, row["D.O.B"]);
    strictEqual(dob.ok, false);
    if (!dob.ok) strictEqual(dob.issue, "notDate");

    const leaving = coerceFieldValue(YEAR_OF_LEAVING, row["Year of Leaving"]);
    strictEqual(leaving.ok, false);
    if (!leaving.ok) strictEqual(leaving.issue, "notYear");

    // The raw text survives for the error message, so the operator is told
    // WHICH value failed rather than just that something did.
    strictEqual(row["Year of Leaving"], "n/a");
  });

  it("leaves a genuinely empty cell empty, and calls it no error", async () => {
    const file = buildXlsx([
      HEADERS,
      [
        { text: "Vikram Rao" },
        { text: "STU0045" },
        { text: "" },
        { text: "" },
        { text: "" },
        { text: "" },
      ],
    ]);

    const parsed = await parseImportFile(file);
    strictEqual(parsed.ok, true);
    if (!parsed.ok) return;
    const row = parsed.sheet.rows[0];

    deepStrictEqual(coerceFieldValue(DOB, row["D.O.B"]), { ok: true, value: "" });
    deepStrictEqual(coerceFieldValue(YEAR_OF_LEAVING, row["Year of Leaving"]), {
      ok: true,
      value: "",
    });
    deepStrictEqual(readAdmissionYear(row["Year of admission"]), {
      ok: true,
      value: null,
    });
  });

  it("still reads a plain CSV the same way", async () => {
    const csv =
      "Name,Roll No,Caste,D.O.B,Year of admission,Year of Leaving\n" +
      "Meera Joshi,STU0046,NT,15-Jun-1999,2024-25,2028\n";
    const parsed = await parseImportFile(new File([csv], "roster.csv"));
    strictEqual(parsed.ok, true);
    if (!parsed.ok) return;
    const row = parsed.sheet.rows[0];

    deepStrictEqual(coerceFieldValue(DOB, row["D.O.B"]), {
      ok: true,
      value: "1999-06-15",
    });
    deepStrictEqual(coerceFieldValue(YEAR_OF_LEAVING, row["Year of Leaving"]), {
      ok: true,
      value: "2028",
    });
    deepStrictEqual(readAdmissionYear(row["Year of admission"]), {
      ok: true,
      value: 2024,
    });
  });
});
