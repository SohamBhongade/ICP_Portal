// /dashboard is the generic post-login target; it forwards to the role's home.
// Keeping this indirection means proxy + loginAction can always send users to
// one stable path.

import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";

export default async function DashboardPage() {
  const user = await requireUser();
  redirect(`/${user.role}`);
}
