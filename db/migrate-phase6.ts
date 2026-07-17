// One-off production data migration for the RBAC + course-normalization changes.
//
// Run with:  npx tsx db/migrate-phase6.ts
//
// Idempotent: safe to run repeatedly. Like seed.ts, tsx runs OUTSIDE Next.js so
// we load .env.local manually and import the db client dynamically afterwards.
//
// What it does:
//   1. Roles: migrate the removed "teacher" role -> "faculty" (attendance-only,
//      matching a teacher's old capabilities). Change DEFAULT_TEACHER_TARGET to
//      "staff" if you prefer.
//   2. Courses: normalize legacy course values ("B.Pharm"/"D.Pharm"/"M.Pharm")
//      to the canonical enum ("B.pharm"/"D.pharm"/"M.pharm") on BOTH the users
//      table and the course dropdown_options, so roster filters keep matching.
//
// Fees note: "Development fees" and "Scholarship (fund)" are UI dropdown options
// that get written as free-text `particulars` on fee_ledgers rows. They are NOT
// enums or separate tables and require NO production setup.

import { config } from "dotenv";
config({ path: ".env.local" });

import { eq, sql } from "drizzle-orm";
import { users, dropdownOptions } from "./schema";

const DEFAULT_TEACHER_TARGET: "faculty" | "staff" = "faculty";

// Legacy stored value -> canonical enum value (see lib/courses.ts).
const COURSE_FIXES: { from: string; to: string }[] = [
  { from: "B.Pharm", to: "B.pharm" },
  { from: "D.Pharm", to: "D.pharm" },
  { from: "M.Pharm", to: "M.pharm" },
];

let db: (typeof import("./index"))["db"];

async function migrateRoles() {
  // `role` is plain text in SQLite (no CHECK constraint), so a straight UPDATE
  // works even though "teacher" is no longer in the TS enum.
  const res = await db
    .update(users)
    .set({ role: DEFAULT_TEACHER_TARGET, updatedAt: new Date() })
    .where(eq(users.role, "teacher" as (typeof users.role.enumValues)[number]))
    .returning({ id: users.id });
  console.log(`  ✓ Roles: ${res.length} "teacher" -> "${DEFAULT_TEACHER_TARGET}"`);
}

async function migrateCourses() {
  for (const fix of COURSE_FIXES) {
    const u = await db
      .update(users)
      .set({ course: fix.to })
      .where(eq(users.course, fix.from))
      .returning({ id: users.id });

    // dropdown_options: keep the pretty label, canonicalize the stored value.
    await db
      .update(dropdownOptions)
      .set({ value: fix.to })
      .where(
        sql`${dropdownOptions.category} = 'course' AND ${dropdownOptions.value} = ${fix.from}`,
      );

    console.log(`  ✓ Course "${fix.from}" -> "${fix.to}" (${u.length} students)`);
  }
}

async function main() {
  console.log("Phase 6 migration...\n");
  db = (await import("./index")).db;
  await migrateRoles();
  await migrateCourses();
  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
