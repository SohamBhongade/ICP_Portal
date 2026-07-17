"use server";

// Phase 11 — Support server actions.
//
// Support tickets:
//   - createTicketAction:       student opens a ticket
//   - updateTicketStatusAction: admin responds + flips the status flag
//
// Every action re-verifies the caller's role server-side (never trust the
// client) and returns a typed result rather than throwing.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { supportTickets, type User } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/auth/session";

/** Return the current user only if their role is allowed, else null. */
async function getRoleUser(...roles: Role[]): Promise<User | null> {
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
  | { ok: false; error: "forbidden" | "invalid" };

export async function createTicketAction(
  input: CreateTicketInput,
): Promise<TicketResult> {
  const student = await getRoleUser("student");
  if (!student) return { ok: false, error: "forbidden" };

  const message = input.message?.trim();
  if (!message || !TICKET_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "invalid" };
  }

  await db.insert(supportTickets).values({
    studentId: student.id,
    category: input.category,
    subject: input.subject?.trim() || null,
    message,
    status: "open",
  });

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
  if (!(await getRoleUser("admin"))) {
    return { ok: false, error: "forbidden" };
  }
  if (!TICKET_STATUSES.includes(input.status)) {
    return { ok: false, error: "invalid" };
  }

  await db
    .update(supportTickets)
    .set({
      status: input.status,
      response: input.response?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, input.id));

  revalidatePath("/admin/support");
  revalidatePath("/student/support");
  return { ok: true };
}
