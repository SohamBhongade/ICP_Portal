// One-off production migration: add users.admission_year and backfill it.
//
// Run with:  npm run db:migrate-admission-year
//
// Idempotent: the ADD COLUMN is guarded, and the backfill only fills rows whose
// admission_year is still empty. tsx runs OUTSIDE Next.js, so .env.local is
// loaded manually and the db client is imported dynamically afterwards.
//
// BACKFILL SOURCE: any custom column (Users > Edit columns) whose label or key
// mentions "admission" — e.g. a "Year of admission" column created earlier.
// Its values are read with the same parser the import uses, so "2024-25",
// "2024-2025" and "2024-06-15" all become 2024. The custom column itself is
// left alone: once you've checked the new built-in "Admission year" column,
// delete the old custom one from Users > Edit columns.
//
// IMPORTANT: run this BEFORE deploying — the app selects the new column.

import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { parseAdmissionYear } from "../lib/academic-year";

async function main() {
  const { db } = await import("./index");
  const { users, userFields, userFieldValues } = await import("./schema");

  console.log("Admission-year migration\n");

  // 1. Add the column if missing. Checked with PRAGMA rather than by catching
  //    "duplicate column name": Drizzle wraps driver errors, so the message
  //    check is unreliable across versions.
  const columns = await db.all<{ name: string }>(sql`PRAGMA table_info(users)`);
  if (columns.some((c) => c.name === "admission_year")) {
    console.log("  • users.admission_year already exists — skipped.");
  } else {
    await db.run(sql`ALTER TABLE users ADD COLUMN admission_year integer`);
    console.log("  ✓ Added users.admission_year");
  }

  // 2. Backfill from an existing custom "admission" column, if there is one.
  let fields: { id: number; key: string; label: string }[] = [];
  try {
    fields = (
      await db
        .select({ id: userFields.id, key: userFields.key, label: userFields.label })
        .from(userFields)
    ).filter((f) => /admission|admitted/i.test(`${f.key} ${f.label}`));
  } catch {
    // user_fields doesn't exist (Phase 9 migration never ran) — nothing to copy.
  }

  if (fields.length === 0) {
    console.log("  • No custom admission column found — nothing to backfill.");
  } else {
    const values = await db
      .select({ userId: userFieldValues.userId, value: userFieldValues.value })
      .from(userFieldValues)
      .where(inArray(userFieldValues.fieldId, fields.map((f) => f.id)));

    let filled = 0;
    let unreadable = 0;
    for (const v of values) {
      const year = parseAdmissionYear(v.value);
      if (year == null) {
        if (v.value?.trim()) unreadable++;
        continue;
      }
      const res = await db
        .update(users)
        .set({ admissionYear: year })
        .where(and(eq(users.id, v.userId), isNull(users.admissionYear)))
        .returning({ id: users.id });
      filled += res.length;
    }
    console.log(
      `  ✓ Copied from "${fields.map((f) => f.label).join('", "')}": ${filled} student(s) filled` +
        (unreadable ? `, ${unreadable} value(s) had no readable year` : ""),
    );
    console.log(
      "    Check the new Admission year column, then delete the old custom column in Users > Edit columns.",
    );
  }

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
