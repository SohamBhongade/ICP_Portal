// Admin overview (Phase 12) — live metrics.
//
// Server component: runs the dashboard queries (active students, unresolved
// support tickets, fees collected this month) then hands plain numbers to the
// client overview for translated rendering.

import { and, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db";
import { feeLedgers, supportTickets, users } from "@/db/schema";
import { requireRole } from "@/lib/auth";
import { monthBounds } from "@/lib/dates";
import { AdminOverview } from "./AdminOverview";

export default async function AdminDashboardPage() {
  await requireRole("admin");
  const { start, end } = monthBounds();

  const [students, openTickets, payments] = await Promise.all([
    db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.role, "student"), eq(users.status, "active"))),
    db
      .select({ id: supportTickets.id })
      .from(supportTickets)
      .where(inArray(supportTickets.status, ["open", "in_progress"])),
    db
      .select({ amount: feeLedgers.amount })
      .from(feeLedgers)
      .where(
        and(
          eq(feeLedgers.type, "payment"),
          gte(feeLedgers.date, start),
          lte(feeLedgers.date, end),
        ),
      ),
  ]);

  const feesThisMonth = payments.reduce((sum, p) => sum + p.amount, 0);

  return (
    <AdminOverview
      activeStudents={students.length}
      pendingTickets={openTickets.length}
      feesThisMonth={feesThisMonth}
    />
  );
}
