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
import { customColumnKey } from "@/lib/user-fields";
import {
  listUserFields,
  loadUserFieldValues,
} from "@/lib/user-fields-query";
import { UsersContent } from "./UsersContent";

export default async function UsersPage() {
  const me = await requireCapability("manageUsers");
  const [rows, courseOpts, classOpts, batchOpts, customFields] = await Promise.all([
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
        year: users.year,
        admissionYear: users.admissionYear,
        status: users.status,
        createdAt: users.createdAt,
      })
      .from(users)
      .orderBy(desc(users.createdAt)),
    getDropdownOptions("course"),
    getDropdownOptions("class"),
    getDropdownOptions("practical_batch"),
    listUserFields(),
  ]);

  // Custom column values for the whole page in ONE query, then attached to each
  // row. Per-row queries would be a few hundred round trips for data that fits
  // in a single narrow result set.
  const valuesByUser =
    customFields.length > 0
      ? await loadUserFieldValues(rows.map((r) => r.id))
      : new Map<number, Record<string, string>>();

  const userRows = rows.map((r) => ({
    ...r,
    custom: valuesByUser.get(r.id) ?? {},
  }));

  const toItems = (opts: { id: number; value: string; label: string }[]) =>
    opts.map((o) => ({ id: o.id, value: o.value, label: o.label }));

  // Initialize the grid from the admin's saved layout (falls back to the full
  // default set when they've never customized it). Sanitized so a stale blob
  // that predates a column change can never break rendering.
  // The custom-column keys are passed in as the second whitelist argument, so a
  // saved layout can carry admin-defined columns and a layout naming a DELETED
  // column self-heals here rather than needing a cleanup migration.
  const savedLayout = sanitizeUsersTableLayout(
    (me.uiPreferences as UiPreferences | null)?.usersTable,
    customFields.map((f) => customColumnKey(f.key)),
  );

  return (
    <UsersContent
      users={userRows}
      customFields={customFields}
      courseOptions={toItems(courseOpts)}
      classOptions={toItems(classOpts)}
      batchOptions={toItems(batchOpts)}
      canDelete={can(me.role as Role, "deleteUsers")}
      // Adding / renaming / dropping a column is a CONFIGURATION change, so it
      // sits behind `settings` (admin only) rather than manageUsers. The server
      // actions re-check the same capability.
      canManageColumns={can(me.role as Role, "settings")}
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
