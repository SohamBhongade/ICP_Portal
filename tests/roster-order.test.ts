// Roster ordering: admission year, then roll number, both ascending.
//
// The rule the office asked for: "2024 → 1-20, then 2025 → 1-60". These cases
// pin the two ways a naive sort gets it wrong — string-sorting "10" before
// "2", and letting a student with no intake year jump into another year.

import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  compareRollNumbers,
  compareRosterEntries,
  type RosterEntry,
} from "../lib/roster-order";

const student = (
  studentId: string | null,
  admissionYear: number | null,
  fullName = `Student ${studentId ?? "?"}`,
  role = "student",
): RosterEntry => ({ fullName, studentId, admissionYear, role });

const order = (rows: RosterEntry[]) =>
  [...rows].sort(compareRosterEntries).map((r) => r.studentId ?? r.fullName);

test("roll numbers sort numerically, not as text", () => {
  assert.ok(compareRollNumbers("2", "10") < 0);
  assert.ok(compareRollNumbers("10", "9") > 0);
  assert.equal(compareRollNumbers("7", "7"), 0);
});

test("prefixed and slashed roll numbers order the way people read them", () => {
  const rolls = ["DP24-10", "DP24-2", "DP24-1"];
  assert.deepEqual(rolls.sort(compareRollNumbers), [
    "DP24-1",
    "DP24-2",
    "DP24-10",
  ]);
  assert.deepEqual(["25/10", "25/2", "24/9"].sort(compareRollNumbers), [
    "24/9",
    "25/2",
    "25/10",
  ]);
});

test("students group by admission year, then run 1..n inside each year", () => {
  const rows = [
    student("3", 2025),
    student("10", 2024),
    student("1", 2025),
    student("2", 2024),
    student("1", 2024),
  ];
  assert.deepEqual(order(rows), ["1", "2", "10", "1", "3"]);
  // …and the years really are in blocks, oldest first.
  assert.deepEqual(
    [...rows].sort(compareRosterEntries).map((r) => r.admissionYear),
    [2024, 2024, 2024, 2025, 2025],
  );
});

test("a student with no admission year sorts after every known year", () => {
  const rows = [student("5", null), student("9", 2025), student("7", 2024)];
  assert.deepEqual(order(rows), ["7", "9", "5"]);
});

test("staff sort after every student, by name", () => {
  const rows = [
    student(null, null, "Zoya Admin", "admin"),
    student("2", 2024),
    student(null, null, "Anil Faculty", "faculty"),
  ];
  assert.deepEqual(order(rows), ["2", "Anil Faculty", "Zoya Admin"]);
});

test("students missing a roll number sort last within their year", () => {
  const rows = [
    student(null, 2024, "No Roll"),
    student("4", 2024),
    student("1", 2024),
  ];
  assert.deepEqual(order(rows), ["1", "4", "No Roll"]);
});

test("a list with no role field is treated as students only", () => {
  const rows: RosterEntry[] = [
    { fullName: "B", studentId: "2", admissionYear: 2024 },
    { fullName: "A", studentId: "1", admissionYear: 2025 },
  ];
  assert.deepEqual(order(rows), ["2", "1"]);
});
