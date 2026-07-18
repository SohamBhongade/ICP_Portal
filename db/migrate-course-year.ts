// One-off production migration: add users.year and backfill it (plus re-canonicalize
// course) from existing free-text course/class values using the dynamic normalizer.
//
// Run with:  npx tsx db/migrate-course-year.ts
//
// Idempotent: the ADD COLUMN is guarded, and the backfill only writes when it can
// derive a year and the row doesn't already have one. tsx runs OUTSIDE Next.js, so
// we load .env.local manually and import the db client dynamically.
//
// IMPORTANT: run this BEFORE deploying the schema change — Drizzle selects the new
// column, so the app expects it to exist. Or run `npm run db:push`.

import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { extractYear, normalizeCourse } from "../lib/courses";

async function main() {
  const { db } = await import("./index");
  const { users } = await import("./schema");

  // 1. Add the column if missing.
  try {
    await db.run(sql`ALTER TABLE users ADD COLUMN year integer`);
    console.log("  ✓ Added users.year");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/duplicate column name/i.test(message)) {
      console.log("  • users.year already exists — skipped.");
    } else {
      throw err;
    }
  }

  // 2. Backfill year + re-canonicalize course for existing students.
  const rows = await db
    .select({
      id: users.id,
      course: users.course,
      className: users.className,
      year: users.year,
    })
    .from(users)
    .where(eq(users.role, "student"));

  let yearSet = 0;
  let courseFixed = 0;
  for (const r of rows) {
    const norm = normalizeCourse(r.course);
    // Year: prefer one embedded in the course cell, else parse the class cell.
    const year = norm.year ?? extractYear(r.className).year;

    const patch: { year?: number; course?: string } = {};
    if (r.year == null && year != null) patch.year = year;
    if (norm.course && norm.course !== r.course) patch.course = norm.course;
    if (Object.keys(patch).length === 0) continue;

    await db.update(users).set(patch).where(eq(users.id, r.id));
    if (patch.year != null) yearSet++;
    if (patch.course) courseFixed++;
  }

  console.log(`  ✓ Backfilled year on ${yearSet} student(s)`);
  console.log(`  ✓ Re-canonicalized course on ${courseFixed} student(s)`);
  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
