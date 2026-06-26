// Admin Support Desk (Phase 11) — triage, respond, and update ticket status.

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { supportTickets, users } from "@/db/schema";
import { AdminSupport, type AdminTicket } from "./AdminSupport";

export default async function AdminSupportPage() {
  const rows = await db
    .select({
      id: supportTickets.id,
      category: supportTickets.category,
      subject: supportTickets.subject,
      message: supportTickets.message,
      status: supportTickets.status,
      response: supportTickets.response,
      createdAt: supportTickets.createdAt,
      studentName: users.fullName,
      studentRoll: users.studentId,
    })
    .from(supportTickets)
    .leftJoin(users, eq(supportTickets.studentId, users.id))
    .orderBy(desc(supportTickets.createdAt));

  const tickets: AdminTicket[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
  }));

  return <AdminSupport tickets={tickets} />;
}
