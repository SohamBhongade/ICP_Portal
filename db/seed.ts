// ICP Portal — idempotent seed script.
//
// Run with:  npm run db:seed   (uses tsx)
//
// tsx runs OUTSIDE the Next.js runtime, so .env.local is not auto-loaded —
// we load it manually with dotenv before importing the db client.
//
// Idempotency strategy:
//   - users:          email is UNIQUE  -> onConflictDoNothing()
//   - app_settings:   key is PRIMARY   -> onConflictDoNothing()
//   - dropdown_options: no unique key  -> check (category,value) before insert
//
// Safe to run repeatedly; it never duplicates rows and never overwrites an
// existing admin password.

import { config } from "dotenv";
config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import { users, dropdownOptions, appSettings } from "./schema";

// NOTE: ESM hoists all `import` statements above top-level code, so a static
// `import { db } from "./index"` would run (and read env) BEFORE config() above.
// We therefore import the db client dynamically inside main(), after dotenv has
// populated process.env.
let db: (typeof import("./index"))["db"];

// --- Dev admin credentials (printed to console after seeding) ---
const ADMIN_EMAIL = "admin@icp.local";
const ADMIN_PASSWORD = "Admin@123"; // dev-only; change in production
const ADMIN_NAME = "ICP Administrator";

// --- Demo staff (dev-only): one account per non-admin staff role ---
const STAFF_DEMOS: { email: string; password: string; name: string; role: "principle" | "office admin" | "faculty" | "staff" }[] = [
  { email: "principle@icp.local", password: "Principle@123", name: "Demo Principle", role: "principle" },
  { email: "officeadmin@icp.local", password: "Office@123", name: "Demo Office Admin", role: "office admin" },
  { email: "faculty@icp.local", password: "Faculty@123", name: "Demo Faculty", role: "faculty" },
  { email: "staff@icp.local", password: "Staff@123", name: "Demo Staff", role: "staff" },
];

const STUDENT_ID = "STU001";
const STUDENT_PASSWORD = "Student@123";
const STUDENT_NAME = "Demo Student";

const SUPPORT_EMAIL =
  process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "icpsupport@gmail.com";

// Starter dropdown options. `value` is the stable stored value, `label` is shown.
const DROPDOWNS: Array<{
  category: "course" | "semester" | "subject" | "class" | "practical_batch";
  value: string;
  label: string;
  sortOrder: number;
}> = [
  // Courses — `value` is the canonical enum (see lib/courses.ts), `label` is the
  // human-friendly display. Keeping the stored value canonical means CSV import,
  // manual create, and attendance/fees roster filters all match on the same key.
  { category: "course", value: "D.pharm", label: "D.Pharm", sortOrder: 1 },
  { category: "course", value: "B.pharm", label: "B.Pharm", sortOrder: 2 },
  { category: "course", value: "M.pharm", label: "M.Pharm", sortOrder: 3 },
  // Classes
  { category: "class", value: "First Year", label: "First Year", sortOrder: 1 },
  { category: "class", value: "Second Year", label: "Second Year", sortOrder: 2 },
  // Practical batches
  { category: "practical_batch", value: "Batch A", label: "Batch A", sortOrder: 1 },
  { category: "practical_batch", value: "Batch B", label: "Batch B", sortOrder: 2 },
  // Subjects (a couple of starters)
  { category: "subject", value: "Pharmaceutics", label: "Pharmaceutics", sortOrder: 1 },
  { category: "subject", value: "Pharmacology", label: "Pharmacology", sortOrder: 2 },
];

async function seedAdmin() {
  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10);
  const result = await db
    .insert(users)
    .values({
      fullName: ADMIN_NAME,
      email: ADMIN_EMAIL,
      passwordHash,
      role: "admin",
      status: "active",
      preferredLanguage: "en",
    })
    .onConflictDoNothing({ target: users.email })
    .returning({ id: users.id });

  if (result.length > 0) {
    console.log(`  ✓ Admin created (id=${result[0].id})`);
  } else {
    console.log("  • Admin already exists — left untouched");
  }
}

async function seedDemoUsers() {
  // One demo account per staff role (all log in with email).
  for (const s of STAFF_DEMOS) {
    const passwordHash = await bcrypt.hash(s.password, 10);
    const row = await db
      .insert(users)
      .values({
        fullName: s.name,
        email: s.email,
        passwordHash,
        role: s.role,
        status: "active",
        preferredLanguage: "en",
      })
      .onConflictDoNothing({ target: users.email })
      .returning({ id: users.id });
    console.log(
      row.length > 0
        ? `  ✓ ${s.name} (${s.role}) created (id=${row[0].id})`
        : `  • ${s.name} (${s.role}) already exists — left untouched`,
    );
  }

  // Student (logs in with student ID).
  const studentHash = await bcrypt.hash(STUDENT_PASSWORD, 10);
  const student = await db
    .insert(users)
    .values({
      fullName: STUDENT_NAME,
      studentId: STUDENT_ID,
      passwordHash: studentHash,
      role: "student",
      status: "active",
      course: "D.pharm",
      className: "First Year",
      practicalBatch: "Batch A",
      preferredLanguage: "en",
    })
    .onConflictDoNothing({ target: users.studentId })
    .returning({ id: users.id });
  console.log(
    student.length > 0
      ? `  ✓ Student created (id=${student[0].id})`
      : "  • Student already exists — left untouched",
  );
}

async function seedDropdowns() {
  let created = 0;
  for (const opt of DROPDOWNS) {
    const existing = await db
      .select({ id: dropdownOptions.id })
      .from(dropdownOptions)
      .where(
        and(
          eq(dropdownOptions.category, opt.category),
          eq(dropdownOptions.value, opt.value),
        ),
      )
      .limit(1);

    if (existing.length === 0) {
      await db.insert(dropdownOptions).values({ ...opt, isActive: true });
      created++;
    }
  }
  console.log(`  ✓ Dropdown options: ${created} created, ${DROPDOWNS.length - created} already present`);
}

async function seedSettings() {
  await db
    .insert(appSettings)
    .values([
      { key: "edit_mode", value: "false" },
      { key: "support_email", value: SUPPORT_EMAIL },
    ])
    .onConflictDoNothing({ target: appSettings.key });
  console.log(`  ✓ App settings: edit_mode, support_email (support=${SUPPORT_EMAIL})`);
}

async function main() {
  console.log("Seeding ICP Portal database...\n");

  // Import the db client now that .env.local is loaded.
  db = (await import("./index")).db;

  await seedAdmin();
  await seedDemoUsers();
  await seedDropdowns();
  await seedSettings();

  console.log("\n────────────────────────────────────────");
  console.log("Seed complete. Dev login credentials:");
  console.log(`  Admin   (staff):   ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`);
  for (const s of STAFF_DEMOS) {
    console.log(`  ${s.role.padEnd(13)}(staff):  ${s.email} / ${s.password}`);
  }
  console.log(`  Student:           ${STUDENT_ID} / ${STUDENT_PASSWORD}`);
  console.log("  (Change these passwords in production.)");
  console.log("────────────────────────────────────────");

  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
