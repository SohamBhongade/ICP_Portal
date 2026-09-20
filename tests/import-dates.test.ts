// Tests for the shared import date/year normaliser.
//
// Run with:  npm test
//
// These cover the exact cases that were silently dropping values before:
// Excel serial dates, DD/MM/YYYY strings typed by staff, bare year integers,
// "2024-25" academic-year strings, empty cells, and garbage input.
//
// No test framework is installed — this uses node:test, which ships with Node,
// executed through the tsx loader that is already a devDependency.

import { deepStrictEqual, strictEqual } from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isBlankCell,
  normalizeDateCell,
  normalizeYearCell,
} from "../lib/import/dates";
import { parseAdmissionYear, readAdmissionYear } from "../lib/academic-year";
import {
  coerceFieldValue,
  validateFieldValue,
  type CustomField,
} from "../lib/user-fields";

/** A date must parse to exactly this ISO string. */
function date(raw: unknown, expected: string) {
  deepStrictEqual(normalizeDateCell(raw), { ok: true, value: expected }, String(raw));
}

/** A date cell must be refused with this issue. */
function dateFails(raw: unknown, issue: string) {
  const out = normalizeDateCell(raw);
  strictEqual(out.ok, false, `expected ${JSON.stringify(raw)} to fail`);
  if (!out.ok) strictEqual(out.issue, issue, String(raw));
}

function year(raw: unknown, expected: number) {
  deepStrictEqual(normalizeYearCell(raw), { ok: true, value: expected }, String(raw));
}

function yearFails(raw: unknown) {
  strictEqual(
    normalizeYearCell(raw).ok,
    false,
    `expected ${JSON.stringify(raw)} to fail`,
  );
}

describe("normalizeDateCell — Excel serial numbers", () => {
  it("reads the serial a formatted date cell actually contains", () => {
    // Anchors: 1 = 1900-01-01 with Excel's 1900 leap-year quirk, so the
    // conversion is days since 1899-12-30.
    date(45231, "2023-11-01");
    date("45231", "2023-11-01");
    date(45292, "2024-01-01");
    date(36526, "2000-01-01");
  });

  it("reads a serial from a birth year long before 2000", () => {
    // This is the case the old academic-year serial floor (36526) rejected.
    date(34865, "1995-06-15");
  });

  it("ignores a fractional time component", () => {
    date(45231.75, "2023-11-01");
  });

  it("refuses a serial outside the accepted range", () => {
    dateFails(999999, "outOfRange");
    dateFails(5, "outOfRange");
  });
});

describe("normalizeDateCell — typed strings", () => {
  it("reads DD/MM/YYYY DAY-FIRST, the Indian convention", () => {
    date("03/04/2005", "2005-04-03");
    date("3/4/2005", "2005-04-03");
    date("31/12/1999", "1999-12-31");
  });

  it("reads DD-MM-YYYY and DD.MM.YYYY the same way", () => {
    date("03-04-2005", "2005-04-03");
    date("03.04.2005", "2005-04-03");
  });

  it("reads YYYY-MM-DD and ISO datetimes", () => {
    date("2005-04-03", "2005-04-03");
    date("2005-4-3", "2005-04-03");
    date("2005-04-03T00:00:00Z", "2005-04-03");
    date("2005/04/03", "2005-04-03");
  });

  it("reads month names in either order", () => {
    date("15 Jun 2024", "2024-06-15");
    date("15-Jun-24", "2024-06-15");
    date("Jun 15, 2024", "2024-06-15");
    date("15 September 1998", "1998-09-15");
  });

  it("expands a two-digit year around a 2029 pivot", () => {
    date("03/04/05", "2005-04-03");
    date("03/04/95", "1995-04-03");
  });

  it("undoes the import's formula-injection quote", () => {
    // lib/import/parse.ts prefixes a leading -/+/=/@ with a single quote.
    date("'03/04/2005", "2005-04-03");
  });

  it("accepts a real Date object without shifting the day", () => {
    date(new Date(Date.UTC(2005, 3, 3)), "2005-04-03");
  });

  it("refuses a date that does not exist", () => {
    dateFails("31/02/2005", "impossible");
    dateFails("2005-13-01", "impossible");
  });

  it("refuses a bare year instead of inventing a day", () => {
    // THE point of the `year` field type: "2024" on a date column is not
    // 1 January 2024, and it is not Excel serial 2024 either.
    dateFails("2024", "yearOnly");
    dateFails(2024, "yearOnly");
  });

  it("refuses garbage", () => {
    dateFails("not a date", "unreadable");
    dateFails("15/", "unreadable");
    dateFails("—", "unreadable");
    dateFails("N/A", "unreadable");
  });
});

describe("normalizeDateCell — empty cells", () => {
  it("treats blank as a value-less cell, not an error", () => {
    deepStrictEqual(normalizeDateCell(""), { ok: true, value: null });
    deepStrictEqual(normalizeDateCell("   "), { ok: true, value: null });
    deepStrictEqual(normalizeDateCell(null), { ok: true, value: null });
    deepStrictEqual(normalizeDateCell(undefined), { ok: true, value: null });
    strictEqual(isBlankCell(""), true);
    strictEqual(isBlankCell("2024"), false);
  });
});

describe("normalizeYearCell", () => {
  it("reads a bare year integer", () => {
    year(2024, 2024);
    year("2024", 2024);
    year("1998", 1998);
  });

  it("reads academic year strings by their START year", () => {
    year("2024-25", 2024);
    year("2024-2025", 2024);
    year("2024/2025", 2024);
    year("2024 / 25", 2024);
    year("AY 2024-25", 2024);
    year("24-25", 2024);
  });

  it("reads an Excel serial as the year it falls in", () => {
    year(45231, 2023);
    year("45231", 2023);
  });

  it("reads a full date as its year", () => {
    year("15/06/2024", 2024);
    year("2024-06-15", 2024);
  });

  it("treats blank as value-less", () => {
    deepStrictEqual(normalizeYearCell(""), { ok: true, value: null });
    deepStrictEqual(normalizeYearCell(null), { ok: true, value: null });
  });

  it("refuses garbage and out-of-range typos", () => {
    yearFails("not a year");
    yearFails("20245");
    yearFails("abcd");
  });
});

describe("parseAdmissionYear — unchanged contract, shared parser", () => {
  it("keeps returning the start year, or null", () => {
    strictEqual(parseAdmissionYear("2024-25"), 2024);
    strictEqual(parseAdmissionYear("2024-2025"), 2024);
    strictEqual(parseAdmissionYear("2024"), 2024);
    strictEqual(parseAdmissionYear(45231), 2023);
    strictEqual(parseAdmissionYear(""), null);
    strictEqual(parseAdmissionYear(null), null);
    strictEqual(parseAdmissionYear("rubbish"), null);
    // Below the 1950 admission floor.
    strictEqual(parseAdmissionYear("1905"), null);
  });

  it("distinguishes blank from unreadable, which parseAdmissionYear cannot", () => {
    deepStrictEqual(readAdmissionYear(""), { ok: true, value: null });
    deepStrictEqual(readAdmissionYear("2024-25"), { ok: true, value: 2024 });
    deepStrictEqual(readAdmissionYear("rubbish"), { ok: false });
  });
});

describe("coerceFieldValue — what actually gets stored", () => {
  const dob: CustomField = {
    id: 1,
    key: "d_o_b",
    label: "D.O.B",
    type: "date",
    options: null,
    sortOrder: 0,
  };
  const leaving: CustomField = { ...dob, id: 2, key: "year_of_leaving", label: "Year of Leaving", type: "year" };
  const caste: CustomField = { ...dob, id: 3, key: "caste", label: "Caste", type: "text" };
  const batch: CustomField = {
    ...dob,
    id: 4,
    key: "batch",
    label: "Batch",
    type: "select",
    options: ["A", "B"],
  };

  it("coerces every accepted date shape to the stored date-only value", () => {
    deepStrictEqual(coerceFieldValue(dob, 45231), { ok: true, value: "2023-11-01" });
    deepStrictEqual(coerceFieldValue(dob, "03/04/2005"), { ok: true, value: "2005-04-03" });
    deepStrictEqual(coerceFieldValue(dob, "2005-04-03"), { ok: true, value: "2005-04-03" });
  });

  it("coerces year shapes to the bare year", () => {
    deepStrictEqual(coerceFieldValue(leaving, "2024-25"), { ok: true, value: "2024" });
    deepStrictEqual(coerceFieldValue(leaving, 2026), { ok: true, value: "2026" });
    deepStrictEqual(coerceFieldValue(leaving, 45231), { ok: true, value: "2023" });
  });

  it("reports rather than drops an unreadable value", () => {
    const bad = coerceFieldValue(dob, "not a date");
    strictEqual(bad.ok, false);
    if (!bad.ok) {
      strictEqual(bad.issue, "notDate");
      strictEqual(bad.detail, "unreadable");
    }
    const yearOnDate = coerceFieldValue(dob, "2024");
    strictEqual(yearOnDate.ok, false);
    if (!yearOnDate.ok) strictEqual(yearOnDate.detail, "yearOnly");
  });

  it("leaves text and select columns exactly as they were", () => {
    deepStrictEqual(coerceFieldValue(caste, " OBC "), { ok: true, value: "OBC" });
    deepStrictEqual(coerceFieldValue(batch, "A"), { ok: true, value: "A" });
    strictEqual(coerceFieldValue(batch, "Z").ok, false);
  });

  it("treats a blank cell as no value", () => {
    deepStrictEqual(coerceFieldValue(dob, ""), { ok: true, value: "" });
    deepStrictEqual(coerceFieldValue(leaving, "   "), { ok: true, value: "" });
    deepStrictEqual(coerceFieldValue(dob, null), { ok: true, value: "" });
  });

  it("round-trips: whatever coerce emits must pass the storage validator", () => {
    for (const [field, raw] of [
      [dob, 45231],
      [dob, "03/04/2005"],
      [leaving, "2024-25"],
      [leaving, 45231],
      [caste, "OBC"],
    ] as const) {
      const out = coerceFieldValue(field, raw);
      strictEqual(out.ok, true);
      if (out.ok) strictEqual(validateFieldValue(field, out.value), null);
    }
  });
});

describe("validateFieldValue — the year type", () => {
  const leaving = { type: "year" as const, options: null };
  it("accepts a bare 4-digit year only", () => {
    strictEqual(validateFieldValue(leaving, "2024"), null);
    strictEqual(validateFieldValue(leaving, ""), null);
    strictEqual(validateFieldValue(leaving, "2024-25"), "notYear");
    strictEqual(validateFieldValue(leaving, "24"), "notYear");
    strictEqual(validateFieldValue(leaving, "20245"), "notYear");
  });
});
