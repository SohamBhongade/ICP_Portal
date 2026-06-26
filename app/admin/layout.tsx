// Admin area layout — role-guarded on the server, then wraps pages in the
// role-aware dashboard shell.

import { requireRole } from "@/lib/auth";
import { getEditMode } from "@/lib/edit-mode/settings";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { EditModeProvider } from "@/components/edit-mode/EditModeProvider";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, editMode] = await Promise.all([
    requireRole("admin"),
    getEditMode(),
  ]);
  return (
    <EditModeProvider canEdit initialEditMode={editMode}>
      <DashboardShell role="admin" user={{ name: user.fullName }}>
        {children}
      </DashboardShell>
    </EditModeProvider>
  );
}
