// Student area layout — role-guarded (admins allowed too, per proxy rules).

import { requireRole } from "@/lib/auth";
import { getEditMode } from "@/lib/edit-mode/settings";
import { DashboardShell } from "@/components/layout/DashboardShell";
import { EditModeProvider } from "@/components/edit-mode/EditModeProvider";

export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [user, editMode] = await Promise.all([
    requireRole("student", "admin"),
    getEditMode(),
  ]);
  return (
    <EditModeProvider canEdit={user.role === "admin"} initialEditMode={editMode}>
      <DashboardShell role="student" user={{ name: user.fullName }}>
        {children}
      </DashboardShell>
    </EditModeProvider>
  );
}
