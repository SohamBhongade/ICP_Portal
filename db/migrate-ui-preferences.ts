// One-off production migration: add the users.ui_preferences JSON column that
// backs the dynamic Users-grid column customization feature.
//
// Run with:  npx tsx db/migrate-ui-preferences.ts
//
// Idempotent: safe to run repeatedly. tsx runs OUTSIDE Next.js, so we load
// .env.local manually and import the db client dynamically afterwards (same
// pattern as migrate-phase6.ts / seed.ts).
//
// IMPORTANT: run this BEFORE deploying the schema change. Drizzle selects every
// column of `users` (e.g. getCurrentUser), so once the app expects
// `ui_preferences` it will error on every request until the column exists.
//
// Alternatively, `npm run db:push` will add the column too (it diffs the schema
// against the DB); this script is the surgical, migration-file-free equivalent.

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("./index");

  // SQLite has no "ADD COLUMN IF NOT EXISTS"; ADD COLUMN throws if it already
  // exists. Swallow that specific case so re-runs are harmless.
  try {
    await db.run(sql`ALTER TABLE users ADD COLUMN ui_preferences text`);
    console.log("  ✓ Added users.ui_preferences column.");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate column name/i.test(message)) {
      console.log("  • users.ui_preferences already exists — nothing to do.");
    } else {
      throw err;
    }
  }

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
