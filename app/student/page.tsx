// Student overview (Phase 12) — live metrics.
//
// Cumulative attendance % (present / total) + outstanding fee balance
// (charges − payments) + recent circulars feed.

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { attendanceLogs, feeLedgers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computeBalances } from "@/lib/fees";
import { getRecentCirculars } from "@/lib/circulars";
import { StudentOverview } from "./StudentOverview";

export default async function StudentDashboardPage() {
  const user = await requireUser();

  const [attendance, ledger, circulars] = await Promise.all([
    db
      .select({ status: attendanceLogs.status })
      .from(attendanceLogs)
      .where(eq(attendanceLogs.studentId, user.id)),
    db
      .select({ type: feeLedgers.type, amount: feeLedgers.amount })
      .from(feeLedgers)
      .where(eq(feeLedgers.studentId, user.id)),
    getRecentCirculars(),
  ]);

  const totalClasses = attendance.length;
  const present = attendance.filter((a) => a.status === "present").length;
  const attendancePct = totalClasses
    ? Math.round((present / totalClasses) * 100)
    : 0;
  const outstanding = computeBalances(ledger).balance;

  return (
    <StudentOverview
      attendancePct={attendancePct}
      totalClasses={totalClasses}
      outstanding={outstanding}
      circulars={circulars}
    />
  );
}
