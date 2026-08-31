// ICP Portal — DEV-ONLY account reset.
//
// Run with:  npm run db:reset-dev
//
// Wipes every user account and every record that hangs off a user, so a dev /
// staging database can be re-provisioned from scratch (see db/create-admin.ts).
//
// tsx runs OUTSIDE the Next.js runtime, so .env.local is not auto-loaded — we
// load it manually with dotenv and import the db client dynamically afterwards
// (ESM hoists static imports above top-level code, which would read env too
// early). Same pattern as db/seed.ts.
//
// SAFETY
//   1. Refuses outright when NODE_ENV === "production".
//   2. Requires the operator to type RESET at an interactive prompt. If stdin
//      is not a TTY (CI, piped input) the script aborts instead of assuming yes.
//
// SCOPE — this script NEVER drops or recreates tables, and it never touches the
// Edit Mode backbone (dropdown_options / app_settings / text_overrides). It only
// DELETEs rows from, in child-before-parent order so SQLite's FOREIGN KEY
// constraints can never fire:
//
//     support_tickets  ->  fee_ledgers  ->  attendance_logs
//                      ->  user_field_values  ->  users

import { config } from "dotenv";
config({ path: ".env.local" });

import { createInterface } from "node:readline/promises";
import { sql } from "drizzle-orm";
import {
  attendanceLogs,
  feeLedgers,
  supportTickets,
  userFieldValues,
  users,
} from "./schema";

// Imported dynamically inside main(), after dotenv has populated process.env.
let db: (typeof import("./index"))["db"];

const CONFIRM_WORD = "RESET";

/** Tables this script clears, in the exact order they must be deleted. */
const DELETION_ORDER = [
  { label: "support_tickets", table: supportTickets },
  { label: "fee_ledgers", table: feeLedgers },
  { label: "attendance_logs", table: attendanceLogs },
  // Phase 9. Every user_field_values row references a user, so it MUST be
  // cleared before the users table — otherwise a reset leaves rows pointing at
  // ids that no longer exist, and the next seed silently re-associates them
  // with whatever account happens to reuse the id.
  { label: "user_field_values", table: userFieldValues },
  { label: "users", table: users },
] as const;

async function countRows(table: (typeof DELETION_ORDER)[number]["table"]) {
  const [row] = await db.select({ n: sql<number>`count(*)` }).from(table);
  return Number(row?.n ?? 0);
}

function abort(message: string): never {
  console.error(`\n✗ ${message}\n`);
  process.exit(1);
}

async function confirm(): Promise<void> {
  if (!process.stdin.isTTY) {
    abort(
      "stdin is not interactive, so the RESET confirmation cannot be given. " +
        "Run this command directly in a terminal.",
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await rl.question(
      `Type ${CONFIRM_WORD} (in capitals) to permanently delete these rows: `,
    );
    if (answer.trim() !== CONFIRM_WORD) {
      abort("Confirmation did not match. Nothing was deleted.");
    }
  } finally {
    rl.close();
  }
}

async function main() {
  // --- Guard 1: never in production. -------------------------------------
  if (process.env.NODE_ENV === "production") {
    abort(
      'NODE_ENV is "production". This script is dev-only and refuses to run.',
    );
  }

  db = (await import("./index")).db;

  // Show the operator exactly what is about to disappear, and from which DB.
  const counts: Record<string, number> = {};
  for (const { label, table } of DELETION_ORDER) {
    counts[label] = await countRows(table);
  }
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  console.log("");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("!!                                                            !!");
  console.log("!!   DESTRUCTIVE: DEV DATABASE ACCOUNT RESET                  !!");
  console.log("!!   Every user account and all dependent records are wiped.  !!");
  console.log("!!   This CANNOT be undone.                                   !!");
  console.log("!!                                                            !!");
  console.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  console.log("");
  console.log(`  Database : ${process.env.TURSO_DATABASE_URL ?? "(unset)"}`);
  console.log(`  NODE_ENV : ${process.env.NODE_ENV ?? "(unset)"}`);
  console.log("");
  console.log("  Rows to be deleted (child-before-parent order):");
  for (const { label } of DELETION_ORDER) {
    console.log(`    ${label.padEnd(18)} ${counts[label]}`);
  }
  console.log(`    ${"TOTAL".padEnd(18)} ${total}`);
  console.log("");
  console.log("  PRESERVED (never touched): dropdown_options, app_settings,");
  console.log("  text_overrides. No table is dropped.");
  console.log("");

  if (total === 0) {
    console.log("Nothing to delete — the account tables are already empty.\n");
    process.exit(0);
  }

  await confirm();

  console.log("\nDeleting...");
  for (const { label, table } of DELETION_ORDER) {
    await db.delete(table);
    console.log(`  ✓ ${label} cleared (${counts[label]} rows)`);
  }

  // Verify we actually ended at zero rather than trusting the DELETEs blindly.
  let leftovers = 0;
  for (const { label, table } of DELETION_ORDER) {
    const remaining = await countRows(table);
    if (remaining > 0) {
      leftovers += remaining;
      console.error(`  ✗ ${label} still has ${remaining} rows`);
    }
  }
  if (leftovers > 0) abort(`Reset incomplete — ${leftovers} rows remain.`);

  console.log("\n────────────────────────────────────────");
  console.log("Reset complete. Next step:");
  console.log("  npm run db:create-admin -- --email <you@example.com> --password <strong-password>");
  console.log("────────────────────────────────────────\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
