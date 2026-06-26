// Drizzle DB client for Turso (libSQL).
//
// This module is imported by Server Components / Server Actions / route
// handlers only — never ship the auth token to the client.

import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url) {
  throw new Error(
    "TURSO_DATABASE_URL is not set. Add it to .env.local (see README / Phase 1 notes).",
  );
}

const client = createClient({ url, authToken });

export const db = drizzle(client, { schema });

export { schema };
