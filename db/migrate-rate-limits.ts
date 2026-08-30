// One-off migration: create the `rate_limits` table that backs durable
// throttling (see lib/rate-limit/).
//
// Run with:  npx tsx db/migrate-rate-limits.ts
//        or: npm run db:push   (drizzle-kit diffs the schema and adds it too)
//
// Idempotent — CREATE TABLE IF NOT EXISTS. tsx runs OUTSIDE Next.js, so
// .env.local is loaded manually and the db client imported dynamically (same
// pattern as the other migrate-*.ts scripts).
//
// This table holds no user data: it is counters keyed by IP or login
// identifier. db/reset-dev.ts deliberately does not touch it.

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

async function main() {
  const { db } = await import("./index");

  await db.run(sql`
    CREATE TABLE IF NOT EXISTS rate_limits (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    )
  `);
  console.log("  ✓ rate_limits table ready");

  // Pruning scans by expiry, so index it.
  await db.run(
    sql`CREATE INDEX IF NOT EXISTS rate_limits_expires_at ON rate_limits (expires_at)`,
  );
  console.log("  ✓ rate_limits_expires_at index ready");

  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
