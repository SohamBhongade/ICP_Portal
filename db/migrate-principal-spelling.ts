// One-off production migration: fix the misspelled "principle" role.
//
// Run with:  npx tsx db/migrate-principal-spelling.ts
//
// Idempotent: safe to run repeatedly. tsx runs OUTSIDE Next.js, so we load
// .env.local manually and import the db client dynamically (same pattern as
// migrate-phase6.ts / seed.ts).
//
// `role` is plain TEXT in SQLite (the enum is a TS-only constraint — see the
// schema header), so a straight UPDATE is all that's needed; no ALTER, no CHECK
// constraint to rebuild. Existing sessions still carrying role="principle" in
// their signed cookie will simply lose access until the user logs in again
// (their capabilities re-resolve from the DB on the next login).

import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";

async function main() {
  const { db } = await import("./index");
  const { users } = await import("./schema");

  const res = await db
    .update(users)
    // Cast: "principle" is no longer a member of the TS enum, but it may still
    // exist as stored text — this is exactly the row we're migrating.
    .set({ role: "principal" })
    .where(eq(users.role, "principle" as (typeof users.role.enumValues)[number]))
    .returning({ id: users.id });

  console.log(`  ✓ Roles: ${res.length} "principle" -> "principal"`);

  // Sanity: no stragglers left.
  const [{ leftover }] = await db
    .select({ leftover: sql<number>`count(*)` })
    .from(users)
    .where(eq(users.role, "principle" as (typeof users.role.enumValues)[number]));
  console.log(`  • Remaining "principle" rows: ${leftover}`);

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
