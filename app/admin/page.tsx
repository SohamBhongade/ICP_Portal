// Admin Overview.
//
// Phase 7 CLEARED this page. It previously ran a grouped SQL aggregation
// (active students by course + year) to feed an "Active students" stat tile and
// a per-course/per-year breakdown widget. Both the query and the AdminOverview
// component were removed; the route, the layout shell, the sidebar and the
// header are untouched.
//
// The capability guard stays exactly as it was — clearing the content region is
// not a reason to loosen who may reach the route.

import { requireAnyCapability } from "@/lib/auth";
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

export default async function AdminDashboardPage() {
  const user = await requireAnyCapability("manageUsers", "fees", "settings");
  const t = await getT();

  return (
    <OverviewWelcome
      roleLabel={t(ROLE_LABEL_KEY[user.role as Role])}
      greeting={t("dashboard.welcomeBack", { name: user.fullName })}
      subtitle={t("dashboard.welcomeSubtitle")}
    />
  );
}
