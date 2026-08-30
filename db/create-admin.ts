// ICP Portal — admin account provisioning.
//
// Run with:
//   npm run db:create-admin -- --identifier you@example.com --password '<strong>'
// or, with the credentials in the environment:
//   ADMIN_IDENTIFIER=... ADMIN_PASSWORD=... npm run db:create-admin
//
// Credentials are NEVER hardcoded here: they come from CLI args first, then env
// vars. The password is hashed with bcrypt at cost 12 and is never printed,
// logged, or echoed back.
//
// Idempotent: the email column is UNIQUE, so an existing account is UPDATEd
// (password reset + role/status re-asserted) instead of erroring on the
// constraint. Safe to re-run to rotate the admin password.
//
// IDENTIFIER FORMAT: this is stored in the `email` column (the app's staff
// login identifier — see db/schema.ts), but this CLI script does NOT require
// it to be a well-formed email address (no strict TLD/@ check). The database
// itself has no CHECK constraint on that column, only a UNIQUE one — the RFC
// shape rule lives solely in the app's user-facing signup/edit flows
// (app/actions/auth.ts, app/actions/onboarding.ts), which are unaffected by
// this relaxation. An identifier accepted here just needs to be non-empty,
// contain no whitespace, and fit the column's practical length. This lets you
// provision an internal/short-form login handle (e.g. "admin@icp") without
// it being silently rewritten into something that looks more like an email.
//
// --email / ADMIN_EMAIL are still accepted as aliases for --identifier /
// ADMIN_IDENTIFIER, for compatibility with earlier invocations of this script.
//
// tsx runs OUTSIDE Next.js, so .env.local is loaded manually and the db client
// is imported dynamically afterwards (same pattern as db/seed.ts).

import { config } from "dotenv";
config({ path: ".env.local" });

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { users } from "./schema";

let db: (typeof import("./index"))["db"];

// Cost factor for the admin credential. 12 is the project floor — see the
// shared BCRYPT_COST in app/actions/onboarding.ts.
const BCRYPT_COST = 12;
const MIN_PASSWORD = 8;
// Practical bound only (matches LIMITS.identifier in lib/validation/core.ts) —
// NOT an email-shape check. No whitespace, since it doubles as a login field.
const MAX_IDENTIFIER_LENGTH = 255;
const DEFAULT_NAME = "ICP Administrator";

/** Minimal `--key value` / `--key=value` parser (no dependency needed). */
function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    if (eq !== -1) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[arg.slice(2)] = next;
        i++;
      } else {
        out[arg.slice(2)] = "true";
      }
    }
  }
  return out;
}

function abort(message: string): never {
  console.error(`\n✗ ${message}\n`);
  console.error(
    "Usage: npm run db:create-admin -- --identifier <id> --password <password> [--name <full name>]",
  );
  console.error(
    "   or: set ADMIN_IDENTIFIER / ADMIN_PASSWORD / ADMIN_NAME in the environment.\n",
  );
  process.exit(1);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  // CLI args win over env vars; --identifier/ADMIN_IDENTIFIER win over the
  // legacy --email/ADMIN_EMAIL aliases when both are somehow given. Nothing is
  // defaulted except the display name.
  const identifier = (
    args.identifier ??
    args.email ??
    process.env.ADMIN_IDENTIFIER ??
    process.env.ADMIN_EMAIL ??
    ""
  ).trim();
  const password = args.password ?? process.env.ADMIN_PASSWORD ?? "";
  const fullName =
    (args.name ?? process.env.ADMIN_NAME ?? DEFAULT_NAME).trim() || DEFAULT_NAME;

  if (!identifier) {
    abort("No admin identifier supplied (--identifier or ADMIN_IDENTIFIER).");
  }
  if (/\s/.test(identifier)) {
    abort("The identifier must not contain whitespace.");
  }
  if (identifier.length > MAX_IDENTIFIER_LENGTH) {
    abort(`The identifier is longer than ${MAX_IDENTIFIER_LENGTH} characters.`);
  }
  if (!password) abort("No admin password supplied (--password or ADMIN_PASSWORD).");
  if (password.length < MIN_PASSWORD) {
    abort(`Password must be at least ${MIN_PASSWORD} characters.`);
  }

  // Case-insensitive, mirroring how the app's own auth code normalizes this
  // column (see app/actions/auth.ts) so lookups stay consistent either way.
  const email = identifier.toLowerCase();

  db = (await import("./index")).db;

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST);

  // Idempotency: look the account up first, then UPDATE or INSERT accordingly.
  const [existing] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  let id: number;
  let action: "created" | "updated";

  if (existing) {
    await db
      .update(users)
      .set({
        fullName,
        passwordHash,
        role: "admin",
        status: "active",
        updatedAt: new Date(),
      })
      .where(eq(users.id, existing.id));
    id = existing.id;
    action = "updated";
  } else {
    const [row] = await db
      .insert(users)
      .values({
        fullName,
        email,
        passwordHash,
        role: "admin",
        status: "active",
        preferredLanguage: "en",
      })
      .returning({ id: users.id });
    id = row.id;
    action = "created";
  }

  console.log("");
  console.log("────────────────────────────────────────");
  console.log(`Admin account ${action}.`);
  console.log(`  id         : ${id}`);
  console.log(`  identifier : ${email}`);
  console.log(`  name       : ${fullName}`);
  console.log(`  role       : admin`);
  console.log(`  status     : active`);
  console.log("  password   : (not shown — use the one you supplied)");
  console.log("────────────────────────────────────────");
  console.log("Sign in at /login using the Staff tab.\n");
  process.exit(0);
}

main().catch((err) => {
  console.error("Admin provisioning failed:", err);
  process.exit(1);
});
