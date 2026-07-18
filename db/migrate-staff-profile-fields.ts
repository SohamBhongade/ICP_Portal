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

const COLUMNS = ["employee_id", "department", "designation"];

async function main() {
  const { db } = await import("./index");

  for (const col of COLUMNS) {
    try {
      await db.run(sql.raw(`ALTER TABLE users ADD COLUMN ${col} text`));
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
