// One-off production migration for Phase 9 — dynamic user columns.
//
// Run with:  npm run db:migrate-phase9
//
// Idempotent: every statement is CREATE ... IF NOT EXISTS, so running it twice
// is a no-op. Like the other migrate-* scripts, tsx runs OUTSIDE Next.js, so
// .env.local is loaded manually and the db client is imported dynamically
// afterwards (importing it at module scope would read the env before dotenv).
//
// Creates:
//   user_fields        — one row per admin-defined column (key, label, type…)
//   user_field_values  — one row per (user, field) that actually has a value
//
// Neither touches the `users` table. That is the point: custom columns are
// data, not schema, so no DDL ever runs against a live table at request time.

import { config } from "dotenv";
config({ path: ".env.local" });

import { sql } from "drizzle-orm";

let db: (typeof import("./index"))["db"];

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS user_fields (
     id          INTEGER PRIMARY KEY AUTOINCREMENT,
     key         TEXT NOT NULL UNIQUE,
     label       TEXT NOT NULL,
     type        TEXT NOT NULL DEFAULT 'text',
     options     TEXT,
     sort_order  INTEGER NOT NULL DEFAULT 0,
     is_active   INTEGER NOT NULL DEFAULT 1,
     created_by  INTEGER REFERENCES users(id),
     created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
     updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
   )`,

  `CREATE TABLE IF NOT EXISTS user_field_values (
     id         INTEGER PRIMARY KEY AUTOINCREMENT,
     user_id    INTEGER NOT NULL REFERENCES users(id),
     field_id   INTEGER NOT NULL REFERENCES user_fields(id),
     value      TEXT,
     updated_at INTEGER NOT NULL DEFAULT (unixepoch())
   )`,

  // Makes every value write a deterministic upsert (ON CONFLICT targets it).
  `CREATE UNIQUE INDEX IF NOT EXISTS user_field_values_user_field_uq
     ON user_field_values (user_id, field_id)`,

  // Deleting a column sweeps every value for it — this keeps that one seek.
  `CREATE INDEX IF NOT EXISTS user_field_values_field_idx
     ON user_field_values (field_id)`,
];

async function main() {
  ({ db } = await import("./index"));

  console.log("Phase 9 migration — dynamic user columns\n");
  for (const statement of STATEMENTS) {
    const name = /(?:TABLE|INDEX) IF NOT EXISTS (\w+)/.exec(statement)?.[1];
    await db.run(sql.raw(statement));
    console.log(`  ok  ${name}`);
  }

  const [fields] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM user_fields`,
  );
  const [values] = await db.all<{ n: number }>(
    sql`SELECT COUNT(*) AS n FROM user_field_values`,
  );
  console.log(
    `\nDone. ${fields?.n ?? 0} custom column(s), ${values?.n ?? 0} stored value(s).`,
  );
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
