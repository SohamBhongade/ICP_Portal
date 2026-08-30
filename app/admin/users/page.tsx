// Admin Users / Onboarding Hub (Phase 8).
//
// Server component: loads every user plus the course / class / practical-batch
// dropdown options (Edit Mode backbone), then hands off to the client
// UsersContent which owns search, filtering, the create drawer, and CSV import.

import { desc } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireCapability } from "@/lib/auth";
import { assignableRoles, can, type Role } from "@/lib/auth/permissions";
import { getDropdownOptions } from "@/lib/edit-mode/settings";
import {
  sanitizeUsersTableLayout,
  type UiPreferences,
} from "@/lib/table-layout";
import { UsersContent } from "./UsersContent";

export default async function UsersPage() {
  const me = await requireCapability("manageUsers");
  const [rows, courseOpts, classOpts, batchOpts] = await Promise.all([
    db
      .select({
        id: users.id,
        fullName: users.fullName,
        studentId: users.studentId,
        email: users.email,
        phone: users.phone,
        role: users.role,
        course: users.course,
        className: users.className,
        practicalBatch: users.practicalBatch,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    getDropdownOptions("course"),
    getDropdownOptions("class"),
    getDropdownOptions("practical_batch"),
  ]);

  const toItems = (opts: { id: number; value: string; label: string }[]) =>
    opts.map((o) => ({ id: o.id, value: o.value, label: o.label }));

  // Initialize the grid from the admin's saved layout (falls back to the full
  // default set when they've never customized it). Sanitized so a stale blob
  // that predates a column change can never break rendering.
  const savedLayout = sanitizeUsersTableLayout(
    (me.uiPreferences as UiPreferences | null)?.usersTable,
  );

  return (
    <UsersContent
      users={rows}
      courseOptions={toItems(courseOpts)}
      classOptions={toItems(classOpts)}
      batchOptions={toItems(batchOpts)}
      canDelete={can(me.role as Role, "deleteUsers")}
      canEditStudents={can(me.role as Role, "manageUsers")}
      // Direct account creation (drawer + CSV) is admin-only. This merely hides
      // the buttons; createUserAction / bulkImportStudentsAction re-check it.
      canCreateUsers={can(me.role as Role, "createUsers")}
      currentUserId={me.id}
      assignableRoles={assignableRoles(me.role as Role)}
      savedLayout={savedLayout}
    />
  );
}
