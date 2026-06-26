// Drizzle Kit config for Turso (libSQL / SQLite).
//
// dialect MUST be "turso" — not "mysql"/"postgresql" — because the DB is Turso.
// We load .env.local manually with dotenv since drizzle-kit runs outside the
// Next.js runtime and won't auto-read it.

import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: ".env.local" });

export default defineConfig({
  dialect: "turso",
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN!,
  },
  verbose: true,
  strict: true,
});
