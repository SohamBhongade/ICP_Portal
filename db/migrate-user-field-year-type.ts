// One-off migration: retype year-shaped custom columns from `date` to `year`.
//
// Run with:  npm run db:migrate-field-year-type
//
// WHY
// ---
// "Year of Leaving" and "Year of admission" were created as custom columns of
// type `date`, which stores a full YYYY-MM-DD. A spreadsheet cell reading
// "2024" or "2024-25" cannot become a full date without inventing a day, so
// every such value was rejected — and, before the accompanying fix, rejected
// SILENTLY. `year` is the honest type: it stores the bare 4-digit year.
//
// No DDL is involved. user_fields.type is TEXT and user_field_values.value is
// TEXT for every field type (see db/schema.ts), so this is purely a data
// migration: flip the type, and rewrite any values already stored in the old
// shape ("2024-06-15" -> "2024") so nothing is left unreadable by the new
// validator.
//
// Idempotent: a column already typed `year` is skipped, and a value already in
// bare-year shape is left alone. Safe to re-run.
//
// SCOPE: columns are matched by KEY/LABEL mentioning "year" while NOT mentioning
// a birth-date word — D.O.B stays a `date`, which is correct for it. Anything
// else is listed at the end so you can retype it by hand from
// Users > Edit columns if you want to.

import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { normalizeYearCell } from "../lib/import/dates";

/** A column whose values are years, not dates. */
function looksLikeYearColumn(key: string, label: string): boolean {
  const haystack = `${key} ${label}`.toLowerCase();
  if (!/\byear\b|year_of|yearof/.test(haystack)) return false;
  // "Year of birth" is still a year; "D.O.B" / "date of birth" is not matched
  // by the rule above anyway. Guard only against an explicit full-date column.
  if (/\bdate\b|\bd\.?o\.?b\b/.test(haystack)) return false;
  return true;
}

async function main() {
  const { db } = await import("./index");
  const { userFields, userFieldValues } = await import("./schema");

  console.log("Custom-column year-type migration\n");

  const fields = await db
    .select({
      id: userFields.id,
      key: userFields.key,
      label: userFields.label,
      type: userFields.type,
    })
    .from(userFields)
    .orderBy(userFields.sortOrder, userFields.id);

  if (fields.length === 0) {
    console.log("  • No custom columns exist — nothing to do.");
    return;
  }

  const targets = fields.filter(
    (f) => f.type === "date" && looksLikeYearColumn(f.key, f.label),
  );

  if (targets.length === 0) {
    console.log("  • No `date` columns look like year columns — nothing to do.");
  }

  for (const field of targets) {
    // 1. Rewrite stored values into the bare-year shape FIRST, so there is
    //    never a moment where the column is typed `year` but holds a date.
    const values = await db
      .select({ id: userFieldValues.id, value: userFieldValues.value })
      .from(userFieldValues)
      .where(eq(userFieldValues.fieldId, field.id));

    let rewritten = 0;
    let unreadable = 0;
    for (const row of values) {
      const raw = (row.value ?? "").trim();
      if (!raw || /^\d{4}$/.test(raw)) continue; // already a bare year
      const out = normalizeYearCell(raw);
      if (!out.ok || out.value == null) {
        unreadable++;
        console.log(
          `    ! ${field.label}: value ${JSON.stringify(raw)} (row ${row.id}) ` +
            `is not readable as a year — left as is, fix it from the Users grid.`,
        );
        continue;
      }
      await db
        .update(userFieldValues)
        .set({ value: String(out.value), updatedAt: new Date() })
        .where(eq(userFieldValues.id, row.id));
      rewritten++;
    }

    // 2. Flip the declared type.
    await db
      .update(userFields)
      .set({ type: "year", updatedAt: new Date() })
      .where(eq(userFields.id, field.id));

    console.log(
      `  ✓ ${field.label} (${field.key}): date -> year` +
        ` — ${rewritten} value(s) rewritten, ${unreadable} left for review.`,
    );
  }

  // Report anything a human may still want to retype.
  const remaining = fields.filter(
    (f) => f.type === "date" && !targets.some((t) => t.id === f.id),
  );
  if (remaining.length > 0) {
    console.log("\n  Still typed `date` (correct for real dates):");
    for (const f of remaining) console.log(`    • ${f.label} (${f.key})`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
