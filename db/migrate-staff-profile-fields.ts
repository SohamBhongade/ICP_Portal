// One-off production migration: add the staff professional-detail columns
// (employee_id, department, designation) that back the dynamic account-request
// flow for non-student roles.
//
// Run with:  npx tsx db/migrate-staff-profile-fields.ts
//
// Idempotent: safe to run repeatedly (each ADD COLUMN is guarded). tsx runs
// OUTSIDE Next.js, so we load .env.local manually and import the db client
// dynamically (same pattern as the other migrate-*.ts scripts).
//
// IMPORTANT: run this BEFORE deploying the schema change — Drizzle selects these
// columns (e.g. the requests query), so the app expects them to exist. Or run
// `npm run db:push`, which diffs the schema and adds them too.

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

// The ONLY place in this codebase that builds SQL by string concatenation.
//
// It is unavoidable here: SQLite cannot parameterize an IDENTIFIER, so
// `ALTER TABLE users ADD COLUMN ?` is not valid SQL — the column name must be
// interpolated literally. Every other query in the app (app/, lib/, db/) goes
// through Drizzle's query builder or `sql` template bindings, which parameterize
// values.
//
// What makes this safe, and what keeps it safe:
//   - The names come from this hardcoded list, never from a request. This is a
//     one-off CLI migration; it accepts no arguments and no user input at all.
//   - assertSafeIdentifier() below re-checks each name against a strict pattern
//     immediately before interpolation, so the invariant is enforced by code
//     rather than by the fact that the array happens to be a literal today.
const COLUMNS = ["employee_id", "department", "designation"];

/**
 * Refuse to interpolate anything that is not a plain snake_case identifier.
 * A belt-and-braces guard on the one raw-SQL path in the project.
 */
function assertSafeIdentifier(name: string): string {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(name)) {
    throw new Error(
      `Refusing to build SQL with the unsafe identifier ${JSON.stringify(name)}.`,
    );
  }
  return name;
}

async function main() {
  const { db } = await import("./index");

  for (const col of COLUMNS) {
    try {
      await db.run(
        sql.raw(`ALTER TABLE users ADD COLUMN ${assertSafeIdentifier(col)} text`),
      );
      console.log(`  ✓ Added users.${col}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (/duplicate column name/i.test(message)) {
        console.log(`  • users.${col} already exists — skipped.`);
      } else {
        throw err;
      }
    }
  }

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
