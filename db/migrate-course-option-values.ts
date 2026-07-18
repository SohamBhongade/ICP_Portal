// One-off production migration: canonicalize the `course` dropdown option VALUES
// so they match exactly what lib/courses.normalizeCourse() produces (and what the
// import/create actions store on users.course).
//
// Run with:  npx tsx db/migrate-course-option-values.ts
//
// WHY: option values had drifted to "B.Pharm" (capital P) while stored/normalized
// course values are canonical "B.pharm". That exact-string mismatch made the
// Users course filter and the Edit-user course dropdown fail to match. This aligns
// them. Only the VALUE is rewritten — the human LABEL (e.g. "B.Pharm") is left
// untouched, so the UI looks identical.
//
// Idempotent: re-running is a no-op once values are canonical. tsx runs OUTSIDE
// Next.js, so we load .env.local manually and import the client dynamically.

import { config } from "dotenv";
config({ path: ".env.local" });

import { eq } from "drizzle-orm";
import { normalizeCourse } from "../lib/courses";

async function main() {
  const { db } = await import("./index");
  const { dropdownOptions } = await import("./schema");

  const rows = await db
    .select({ id: dropdownOptions.id, value: dropdownOptions.value })
    .from(dropdownOptions)
    .where(eq(dropdownOptions.category, "course"));

  let fixed = 0;
  for (const r of rows) {
    const canonical = normalizeCourse(r.value).course;
    if (canonical && canonical !== r.value) {
      await db
        .update(dropdownOptions)
        .set({ value: canonical })
        .where(eq(dropdownOptions.id, r.id));
      console.log(`  ✓ course option "${r.value}" -> "${canonical}"`);
      fixed++;
    }
  }

  console.log(
    fixed === 0
      ? "  • All course option values already canonical — nothing to do."
      : `  ✓ Canonicalized ${fixed} course option value(s).`,
  );
  console.log("\nMigration complete.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
