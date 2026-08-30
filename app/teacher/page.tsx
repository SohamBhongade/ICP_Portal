// Teacher Overview.
//
// Phase 7 CLEARED this page. It previously counted distinct attendance sessions
// this teacher recorded in the current ISO week and rendered them in a
// "Classes this week" stat tile. That query and the TeacherOverview component
// were removed; route, shell, sidebar and header are untouched.

import { requireCapability } from "@/lib/auth";
import { OverviewWelcome } from "@/components/dashboard/OverviewWelcome";
import { getT } from "@/lib/i18n/server";
import type { Role } from "@/lib/auth/permissions";

const ROLE_LABEL_KEY: Record<Role, string> = {
  admin: "onboarding.roleAdmin",
  principal: "onboarding.rolePrincipal",
  "office admin": "onboarding.roleOfficeAdmin",
  faculty: "onboarding.roleFaculty",
  staff: "onboarding.roleStaff",
  student: "onboarding.roleStudent",
};

export default async function TeacherDashboardPage() {
  const user = await requireCapability("attendance");
  const t = await getT();

  return (
    <OverviewWelcome
      roleLabel={t(ROLE_LABEL_KEY[user.role as Role])}
      greeting={t("dashboard.welcomeBack", { name: user.fullName })}
      subtitle={t("dashboard.welcomeSubtitle")}
    />
  );
}
