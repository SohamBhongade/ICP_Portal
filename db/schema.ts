// ICP Portal — Drizzle schema
//
// STACK NOTE: The DB is Turso (libSQL / SQLite), NOT MySQL/TiDB. Despite the
// original spec text mentioning "TiDB Serverless (MySQL)", the installed driver
// is @libsql/client, so every table below uses drizzle-orm/sqlite-core.
//
// SQLite has no native boolean / datetime / enum types, so:
//   - booleans  -> integer({ mode: "boolean" })
//   - timestamps-> integer({ mode: "timestamp" }) default (unixepoch())
//   - enums     -> text({ enum: [...] })  (CHECK constraint emulation in TS only)
//
// Design decisions baked in (do not "fix" these):
//   1. Account requests are NOT a separate table — a signup is a `users` row
//      with status='pending'. Admin edits typos, then flips status='active'.
//   2. Fee balance is COMPUTED (sum payments - sum charges), never stored, so
//      editing an old ledger row can never desync a running total.
//   3. dropdownOptions / appSettings / textOverrides are the Edit Mode backbone —
//      they give the "edit dropdowns / system text from the UI" feature a place
//      to persist.

import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  real,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";
// Relative (not "@/") import: drizzle-kit parses this file outside Next.js and
// does not resolve the "@/" path alias. Type-only, so it's erased at runtime.
import type { UiPreferences } from "../lib/table-layout";

// ---------- Users ----------
export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fullName: text("full_name").notNull(),
  studentId: text("student_id").unique(), // null for staff/admins
  email: text("email").unique(), // login identifier for staff
  phone: text("phone"),
  passwordHash: text("password_hash"), // null until activated
  role: text("role", {
    enum: [
      "admin",
      "office admin",
      "principal",
      "staff",
      "faculty",
      "student",
    ],
  })
    .notNull()
    .default("student"),
  course: text("course"), // canonical value from lib/courses normalization
  year: integer("year"), // academic year 1–4 (students); null when unknown
  // Calendar year the student was admitted, e.g. 2024 for "2024-25". Students
  // only; null when unknown. See lib/academic-year.ts for how it is parsed.
  admissionYear: integer("admission_year"),
  className: text("class_name"),
  practicalBatch: text("practical_batch"), // 'Batch A' etc — students only
  // Staff/faculty professional details (null for students). Captured by the
  // self-service request form for non-student roles; informational only —
  // staff still authenticate by email, so employeeId carries no unique constraint.
  employeeId: text("employee_id"),
  department: text("department"),
  designation: text("designation"),
  status: text("status", { enum: ["pending", "active", "rejected"] })
    .notNull()
    .default("pending"),
  preferredLanguage: text("preferred_language", { enum: ["en"] })
    .notNull()
    .default("en"),
  // Per-user UI preferences (JSON). Currently holds the customizable Users-grid
  // column layout; namespaced so other tables can persist their own later.
  // Nullable -> a fresh account falls back to the default layout.
  uiPreferences: text("ui_preferences", { mode: "json" }).$type<UiPreferences>(),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---------- Attendance (three-way: present / absent / late) ----------
// SQLite stores this as plain text, so widening the enum needs no migration —
// existing 'present'/'absent' rows stay valid; 'late' is simply now allowed.
export const attendanceLogs = sqliteTable("attendance_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id")
    .notNull()
    .references(() => users.id),
  date: text("date").notNull(), // 'YYYY-MM-DD'
  status: text("status", { enum: ["present", "absent", "late"] }).notNull(),
  subject: text("subject"),
  className: text("class_name"),
  practicalBatch: text("practical_batch"), // null = theory/regular class
  markedBy: integer("marked_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---------- Fee ledger (admin-writable, student read-only) ----------
export const feeLedgers = sqliteTable("fee_ledgers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id")
    .notNull()
    .references(() => users.id),
  particulars: text("particulars").notNull(),
  type: text("type", { enum: ["charge", "payment"] }).notNull(),
  amount: real("amount").notNull(),
  receiptNo: text("receipt_no"),
  date: text("date").notNull(),
  recordedBy: integer("recorded_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ---------- Support tickets ----------
export const supportTickets = sqliteTable("support_tickets", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  studentId: integer("student_id")
    .notNull()
    .references(() => users.id),
  category: text("category", {
    enum: ["fee", "attendance", "technical", "academic", "administrative"],
  }).notNull(),
  subject: text("subject"),
  message: text("message").notNull(),
  status: text("status", {
    enum: ["open", "in_progress", "resolved", "closed"],
  })
    .notNull()
    .default("open"),
  response: text("response"),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// ===== Edit Mode backbone =====

// Editable dropdowns: courses, semesters, subjects, classes, batches.
export const dropdownOptions = sqliteTable("dropdown_options", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  category: text("category", {
    enum: ["course", "semester", "subject", "class", "practical_batch"],
  }).notNull(),
  value: text("value").notNull(),
  label: text("label").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
});

// Global key/value flags: Edit Mode toggle, support email, etc.
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

// Admin overrides for any UI string, per language. i18n reads JSON first,
// then overlays these so Edit Mode text edits take effect.
export const textOverrides = sqliteTable("text_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  locale: text("locale", { enum: ["en"] }).notNull(),
  key: text("key").notNull(),
  value: text("value").notNull(),
});

// ---------- Rate limiting (durable, shared across serverless invocations) ----------
//
// Vercel serverless gives every invocation its own memory, so an in-process
// counter is not a limit — it is N limits, one per warm lambda, and an attacker
// gets N x the allowance for free. This table is the durable backing store.
//
// One row per (rule, subject) key, e.g. "login:ip:203.0.113.4" or
// "login:id:stu001". Counting is a FIXED WINDOW: `windowStart` marks when the
// current window opened and `count` is incremented atomically by a single
// UPSERT (see lib/rate-limit/store.ts), which is safe under concurrency.
// `expiresAt` exists so stale rows can be pruned cheaply.
export const rateLimits = sqliteTable("rate_limits", {
  key: text("key").primaryKey(),
  count: integer("count").notNull().default(0),
  // Epoch SECONDS (not a Date): the increment happens inside one SQL statement,
  // so the value has to be comparable in SQL without a driver-side conversion.
  windowStart: integer("window_start").notNull(),
  expiresAt: integer("expires_at").notNull(),
});

// ===== Dynamic user columns (Phase 9) =====
//
// The Users grid lets an admin add their own columns ("Guardian phone",
// "Hostel block", …). Those columns are DATA, not schema: this is an
// entity-attribute-value pair of tables, and the `users` table is never altered
// at runtime. Runtime DDL against a live SQLite file would be a migration with
// no review, no rollback, and no way to reconcile against drizzle-kit.

/**
 * One custom column's definition.
 *
 * `key` vs `label` is the load-bearing distinction. `key` is slugified from the
 * label ONCE, at creation, and is then immutable — it is what a saved column
 * layout (users.ui_preferences) and a saved import mapping reference. `label`
 * is the display name and is what "rename" edits. Renaming by key instead would
 * orphan every stored reference to the column.
 */
export const userFields = sqliteTable("user_fields", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  key: text("key").notNull().unique(), // immutable machine key
  label: text("label").notNull(), // mutable display name
  // A display + validation contract enforced in TS, NOT a storage type — see
  // the note on `value` below. `year` stores a bare 4-digit year and exists
  // because "Year of Leaving" is not a timestamp; see lib/user-fields.ts.
  // Widening this list needs no DDL (SQLite stores it as text), only a data
  // migration for rows that should change type — db/migrate-user-field-year-type.ts.
  type: text("type", { enum: ["text", "number", "date", "year", "select"] })
    .notNull()
    .default("text"),
  // Permitted values when type = 'select'; null for every other type.
  options: text("options", { mode: "json" }).$type<string[]>(),
  sortOrder: integer("sort_order").notNull().default(0),
  // Reserved for a future "archive without destroying" flow. The current
  // delete action is a real hard delete (that is what the UI warns about), but
  // every read filters on this so archiving can be added without touching them.
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdBy: integer("created_by").references(() => users.id),
  createdAt: integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
});

/**
 * One user's value for one custom column.
 *
 * `value` is TEXT for every field type, including number and date. SQLite is
 * dynamically typed and a single narrow column keeps this table to one row per
 * (user, field); the declared `type` is what validates and renders it. The bill
 * this defers: sorting a numeric column would need CAST(value AS REAL). There is
 * no column sorting in the grid today, so nothing regresses.
 *
 * The UNIQUE(user_id, field_id) index makes every write a deterministic upsert;
 * an absent row simply means "no value", so adding a column costs zero rows.
 * The field_id index makes deleting a column a single indexed sweep.
 */
export const userFieldValues = sqliteTable(
  "user_field_values",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id),
    fieldId: integer("field_id")
      .notNull()
      .references(() => userFields.id),
    value: text("value"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    uniqueIndex("user_field_values_user_field_uq").on(t.userId, t.fieldId),
    index("user_field_values_field_idx").on(t.fieldId),
  ],
);

// ---------- Inferred types ----------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AttendanceLog = typeof attendanceLogs.$inferSelect;
export type FeeLedger = typeof feeLedgers.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type DropdownOption = typeof dropdownOptions.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
export type UserField = typeof userFields.$inferSelect;
export type NewUserField = typeof userFields.$inferInsert;
export type UserFieldValue = typeof userFieldValues.$inferSelect;
