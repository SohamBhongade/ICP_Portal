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
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

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
      "principle",
      "staff",
      "faculty",
      "student",
    ],
  })
    .notNull()
    .default("student"),
  course: text("course"), // value sourced from dropdown_options
  className: text("class_name"),
  practicalBatch: text("practical_batch"), // 'Batch A' etc — students only
  status: text("status", { enum: ["pending", "active", "rejected"] })
    .notNull()
    .default("pending"),
  preferredLanguage: text("preferred_language", { enum: ["en"] })
    .notNull()
    .default("en"),
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

// ---------- Inferred types ----------
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type AttendanceLog = typeof attendanceLogs.$inferSelect;
export type FeeLedger = typeof feeLedgers.$inferSelect;
export type SupportTicket = typeof supportTickets.$inferSelect;
export type DropdownOption = typeof dropdownOptions.$inferSelect;
