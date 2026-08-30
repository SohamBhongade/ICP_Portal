"use server";

// Phase 11 — Support server actions.
//
// Support tickets:
//   - createTicketAction:       student opens a ticket
//   - updateTicketStatusAction: admin responds + flips the status flag
//
// Every action re-verifies the caller's role server-side at the TOP of the
// function (never trust the client) and returns a typed result rather than
// throwing, so the UI can render a translated message.
//
// A ticket is always bound to the SESSION user's id — createTicketAction never
// reads a student id from the payload, so a student cannot file (or thereby
// read back) a ticket under someone else's account.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { supportTickets, type User } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/auth/permissions";
import { logServerError } from "@/lib/errors";
import { parseInput, type FieldErrors } from "@/lib/validation/core";
import {
  createTicketSchema,
  updateTicketSchema,
} from "@/lib/validation/schemas";

/**
 * Return the current user only if their role is in the allow-list, else null.
 * The non-throwing sibling of lib/auth's requireRole(): same server-side check,
 * reported through the action's typed result instead of a 403 interrupt.
 */
async function getRoleUser(roles: Role[]): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role as Role)) return null;
  return user;
}

export type TicketCategory =
  | "fee"
  | "attendance"
  | "technical"
  | "academic"
  | "administrative";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

const TICKET_CATEGORIES: TicketCategory[] = [
  "fee",
  "attendance",
  "technical",
  "academic",
  "administrative",
];
const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

// ---------- Support tickets ----------

export type CreateTicketInput = {
  category: TicketCategory;
  subject?: string;
  message: string;
};

export type TicketResult =
  | { ok: true }
  | {
      ok: false;
      error: "forbidden" | "invalid" | "validation";
      fieldErrors?: FieldErrors;
    };

export async function createTicketAction(
  input: CreateTicketInput,
): Promise<TicketResult> {
  const student = await getRoleUser(["student"]);
  if (!student) return { ok: false, error: "forbidden" };

  // Bounds the message (5 000 chars) and subject (200), pins the category to the
  // enum, and rejects unknown keys — notably `studentId`, which is taken from
  // the SESSION below and must never be accepted from the payload.
  const parsed = parseInput(createTicketSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const { category, subject, message } = parsed.data;

  if (!TICKET_CATEGORIES.includes(category)) {
    return { ok: false, error: "invalid" };
  }

  try {
    await db.insert(supportTickets).values({
      studentId: student.id,
      category,
      subject: subject ?? null,
      message,
      status: "open",
    });
  } catch (err) {
    logServerError("createTicketAction", err, { studentId: student.id });
    return { ok: false, error: "invalid" };
  }

  revalidatePath("/student/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  return { ok: true };
}

export type UpdateTicketInput = {
  id: number;
  status: TicketStatus;
  response?: string;
};

export async function updateTicketStatusAction(
  input: UpdateTicketInput,
): Promise<TicketResult> {
  // ADMIN ONLY — responding to / triaging a ticket is a staff mutation.
  if (!(await getRoleUser(["admin"]))) {
    return { ok: false, error: "forbidden" };
  }

  const parsed = parseInput(updateTicketSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const { id, status, response } = parsed.data;

  if (!TICKET_STATUSES.includes(status)) {
    return { ok: false, error: "invalid" };
  }

  try {
    await db
      .update(supportTickets)
      .set({
        status,
        response: response ?? null,
        updatedAt: new Date(),
      })
      .where(eq(supportTickets.id, id));
  } catch (err) {
    logServerError("updateTicketStatusAction", err, { ticketId: id });
    return { ok: false, error: "invalid" };
  }

  revalidatePath("/admin/support");
  revalidatePath("/student/support");
  return { ok: true };
}
