// Admin Account Requests (Phase 8 tail) — review pending self-service signups.
//
// Server component: loads every pending account plus the Course / Class /
// Practical-batch dropdowns, then hands off to the client queue where an admin
// can correct typos and approve (→ active) or reject (→ rejected) each request.

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireCapability } from "@/lib/auth";
import { getDropdownOptions } from "@/lib/edit-mode/settings";
import { RequestsContent, type PendingRequest } from "./RequestsContent";

export default async function RequestsPage() {
  // Approvals console is Admin + Principal only (not Office Admin).
  await requireCapability("approveRequests");
  const [rows, courseOpts, classOpts, batchOpts] = await Promise.all([
    db
      .select({
        id: users.id,
        role: users.role,
        fullName: users.fullName,
        studentId: users.studentId,
        email: users.email,
        phone: users.phone,
        course: users.course,
        className: users.className,
        practicalBatch: users.practicalBatch,
        employeeId: users.employeeId,
        department: users.department,
        designation: users.designation,
        createdAt: users.createdAt,
      })
      .from(users)
      .where(eq(users.status, "pending"))
      .orderBy(desc(users.createdAt)),
    getDropdownOptions("course"),
    getDropdownOptions("class"),
    getDropdownOptions("practical_batch"),
  ]);

  const requests: PendingRequest[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
  }));

  const toItems = (opts: { value: string; label: string }[]) =>
    opts.map((o) => ({ value: o.value, label: o.label }));

  return (
    <RequestsContent
      requests={requests}
      courseOptions={toItems(courseOpts)}
      classOptions={toItems(classOpts)}
      batchOptions={toItems(batchOpts)}
    />
  );
}
