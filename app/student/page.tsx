// Student Overview.
//
// Phase 7 CLEARED this page. It previously queried the student's attendance
// ledger and fee ledger to render "Attendance rate" and "Fee balance" stat
// tiles. Both queries and the StudentOverview component were removed; route,
// shell, sidebar and header are untouched.
//
// The data itself is untouched and still reachable from the sidebar at
// /student/attendance and /student/fees.

import { requireUser } from "@/lib/auth";
import { OverviewWelcome } from "@/components/dashboard/OverviewWelcome";
import { getT } from "@/lib/i18n/server";

export default async function StudentDashboardPage() {
  const user = await requireUser();
  const t = await getT();

  return (
    <OverviewWelcome
      roleLabel={t("onboarding.roleStudent")}
      greeting={t("dashboard.welcomeBack", { name: user.fullName })}
      subtitle={t("dashboard.welcomeSubtitle")}
    />
  );
}
