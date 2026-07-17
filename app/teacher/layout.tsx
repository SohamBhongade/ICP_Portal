// Attendance recorder console — guarded by the `attendance` capability
// (admin, principle, faculty, staff). Formerly the "teacher" area.

import { requireCapability } from "@/lib/auth";
import { can, type Role } from "@/lib/auth/permissions";
import { getEditMode } from "@/lib/edit-mode/settings";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { EditModeProvider } from "@/components/edit-mode/EditModeProvider";

export default async function TeacherLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, editMode] = await Promise.all([
    requireCapability("attendance"),
    getEditMode(),
  ]);
  const canEdit = can(user.role as Role, "settings");
  return (
    <EditModeProvider canEdit={canEdit} initialEditMode={editMode}>
      <DashboardShell role={user.role as Role} user={{ name: user.fullName }}>
        {children}
      </DashboardShell>
    </EditModeProvider>
  );
}
