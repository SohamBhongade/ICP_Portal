// Admin Fee Ledger (Phase 10).
//
// Server component: loads the active-student directory (lightweight columns),
// then hands off to the client FeesAdmin which owns student lookup, the ledger
// view, and the post-transaction modal. Per-student ledgers are fetched on
// demand via a server action so we never ship every student's finances at once.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireCapability } from "@/lib/auth";
import { FeesAdmin } from "./FeesAdmin";

export default async function AdminFeesPage() {
  await requireCapability("fees");
  const students = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      studentId: users.studentId,
      course: users.course,
      className: users.className,
      year: users.year,
      admissionYear: users.admissionYear,
    })
    .from(users)
    .where(eq(users.role, "student"))
    .orderBy(asc(users.fullName));

  return <FeesAdmin students={students} />;
}
