// Admin area layout — role-guarded on the server, then wraps pages in the
// role-aware dashboard shell.

import { requireAnyCapability } from "@/lib/auth";
import { can, type Role } from "@/lib/auth/permissions";
import { getEditMode } from "@/lib/edit-mode/settings";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { EditModeProvider } from "@/components/edit-mode/EditModeProvider";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Anyone with a management capability may enter the console; individual pages
  // re-guard their own capability. Attendance-only roles (faculty/staff) are
  // bounced to their landing page.
  const [user, editMode] = await Promise.all([
    requireAnyCapability("manageUsers", "fees", "settings"),
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
