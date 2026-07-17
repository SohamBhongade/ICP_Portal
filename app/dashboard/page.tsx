// /dashboard is the generic post-login target; it forwards to the role's home.
// Keeping this indirection means proxy + loginAction can always send users to
// one stable path.

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { landingPath, type Role } from "@/lib/auth/permissions";

export default async function DashboardPage() {
  const user = await requireUser();
  // Role name no longer maps 1:1 to a route (e.g. "office admin"), so route via
  // the shared landing-path helper instead of `/${role}`.
  redirect(landingPath(user.role as Role));
}
