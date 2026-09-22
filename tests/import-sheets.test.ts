// Which worksheet the importer reads, and how shared strings are indexed.
//
// Both of these fail SILENTLY when they are wrong — the import succeeds and
// stores the wrong data — so they are pinned here with hand-built .xlsx zips.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import { zipSync, strToU8 } from "fflate";
import { parseImportFile } from "../lib/import/parse";

/** Minimal .xlsx: `sheets` is [tab name, rows] in TAB order. */
function workbook(
  sheets: [string, string[][]][],
  opts: { hidden?: string[]; sharedStringsXml?: string } = {},
): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const sheetTags: string[] = [];
  const relTags: string[] = [];

  sheets.forEach(([name, rows], i) => {
    // Deliberately NOT in tab order on disk: tab 1 is stored as the LAST file,
    // which is exactly the case that used to import the wrong sheet.
    const partNumber = sheets.length - i;
    const path = `xl/worksheets/sheet${partNumber}.xml`;
    const xml = rows
      .map(
        (cells, r) =>
          `<row r="${r + 1}">` +
          cells
            .map(
              (v, c) =>
                `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${v}</t></is></c>`,
            )
            .join("") +
          `</row>`,
      )
      .join("");
    files[path] = strToU8(
      `<?xml version="1.0"?><worksheet><sheetData>${xml}</sheetData></worksheet>`,
    );
    const state = opts.hidden?.includes(name) ? ' state="hidden"' : "";
    sheetTags.push(
      `<sheet name="${name}" sheetId="${i + 1}"${state} r:id="rId${i + 1}"/>`,
    );
    relTags.push(
      `<Relationship Id="rId${i + 1}" Target="worksheets/sheet${partNumber}.xml"/>`,
    );
  });

  files["xl/workbook.xml"] = strToU8(
    `<?xml version="1.0"?><workbook><sheets>${sheetTags.join("")}</sheets></workbook>`,
  );
  files["xl/_rels/workbook.xml.rels"] = strToU8(
    `<?xml version="1.0"?><Relationships>${relTags.join("")}</Relationships>`,
  );
  if (opts.sharedStringsXml) {
    files["xl/sharedStrings.xml"] = strToU8(opts.sharedStringsXml);
  }
  files["[Content_Types].xml"] = strToU8("<Types/>");
  return zipSync(files);
}

// `as BlobPart` matches the existing xlsx tests: TS narrows Uint8Array's
// buffer to ArrayBufferLike, which BlobPart does not accept.
const file = (bytes: Uint8Array) => new File([bytes as BlobPart], "book.xlsx");

const ROSTER: [string, string[][]][] = [
  [
    "First Year 2025-2026",
    [
      ["Roll No.", "Full Name of student"],
      ["59", "Rituraj Khumchand Rokade"],
    ],
  ],
  [
    "First Year 2024-2025",
    [
      ["Roll No.", "Full Name of student"],
      ["1", "Last Year Student"],
    ],
  ],
];

test("reads the FIRST TAB, not the first file inside the workbook", async () => {
  const res = await parseImportFile(file(workbook(ROSTER)));
  assert.ok(res.ok);
  assert.equal(res.sheet.sheetName, "First Year 2025-2026");
  assert.equal(res.sheet.rows[0]["Full Name of student"], "Rituraj Khumchand Rokade");
  assert.deepEqual(res.sheet.sheetNames, [
    "First Year 2025-2026",
    "First Year 2024-2025",
  ]);
});

test("a named tab can be chosen, and an unknown name falls back", async () => {
  const chosen = await parseImportFile(file(workbook(ROSTER)), "First Year 2024-2025");
  assert.ok(chosen.ok);
  assert.equal(chosen.sheet.rows[0]["Full Name of student"], "Last Year Student");

  const unknown = await parseImportFile(file(workbook(ROSTER)), "Nope");
  assert.ok(unknown.ok);
  assert.equal(unknown.sheet.sheetName, "First Year 2025-2026");
});

test("hidden tabs are never picked and never offered", async () => {
  const res = await parseImportFile(
    file(workbook(ROSTER, { hidden: ["First Year 2025-2026"] })),
  );
  assert.ok(res.ok);
  assert.equal(res.sheet.sheetName, "First Year 2024-2025");
  assert.deepEqual(res.sheet.sheetNames, ["First Year 2024-2025"]);
});

test("an empty <si/> still takes an index, so later strings stay aligned", async () => {
  // Cells reference shared strings BY POSITION: A2 -> 1, B2 -> 2. If the empty
  // string at index 0 is not counted, every later value shifts by one and the
  // name column quietly shows the email.
  const sheet = strToU8(
    `<?xml version="1.0"?><worksheet><sheetData>` +
      `<row r="1"><c r="A1" t="inlineStr"><is><t>Roll No.</t></is></c><c r="B1" t="inlineStr"><is><t>Email</t></is></c></row>` +
      `<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2" t="s"><v>2</v></c></row>` +
      `</sheetData></worksheet>`,
  );
  const files: Record<string, Uint8Array> = {
    "xl/worksheets/sheet1.xml": sheet,
    "xl/workbook.xml": strToU8(
      `<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst><si/><si><t>59</t></si><si><t>rituraj@example.com</t></si></sst>`,
    ),
  };
  const res = await parseImportFile(file(zipSync(files)));
  assert.ok(res.ok);
  assert.equal(res.sheet.rows[0]["Roll No."], "59");
  assert.equal(res.sheet.rows[0]["Email"], "rituraj@example.com");
});

test("phonetic runs do not get appended to the value", async () => {
  const files: Record<string, Uint8Array> = {
    "xl/worksheets/sheet1.xml": strToU8(
      `<worksheet><sheetData>` +
        `<row r="1"><c r="A1" t="inlineStr"><is><t>Full Name of student</t></is></c></row>` +
        `<row r="2"><c r="A2" t="s"><v>0</v></c></row>` +
        `</sheetData></worksheet>`,
    ),
    "xl/workbook.xml": strToU8(
      `<workbook><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    ),
    "xl/_rels/workbook.xml.rels": strToU8(
      `<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>`,
    ),
    "xl/sharedStrings.xml": strToU8(
      `<sst><si><t>Tannu Umesh Bisne</t><rPh sb="0" eb="4"><t>PHONETIC</t></rPh></si></sst>`,
    ),
  };
  const res = await parseImportFile(file(zipSync(files)));
  assert.ok(res.ok);
  assert.equal(res.sheet.rows[0]["Full Name of student"], "Tannu Umesh Bisne");
});
