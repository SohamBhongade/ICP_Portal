// Student Support (Phase 11) — raise a ticket + track active tickets.

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { supportTickets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { StudentSupport, type StudentTicket } from "./StudentSupport";

export default async function StudentSupportPage() {
  const user = await requireUser();

  const rows = await db
    .select({
      id: supportTickets.id,
      category: supportTickets.category,
      subject: supportTickets.subject,
      message: supportTickets.message,
      status: supportTickets.status,
      response: supportTickets.response,
      createdAt: supportTickets.createdAt,
    })
    .from(supportTickets)
    .where(eq(supportTickets.studentId, user.id))
    .orderBy(desc(supportTickets.createdAt));

  const tickets: StudentTicket[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
  }));

  return <StudentSupport tickets={tickets} />;
}
