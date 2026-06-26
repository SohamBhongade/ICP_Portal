import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

// Root: send authenticated users to their dashboard, everyone else to login.
export default async function Home() {
  const user = await getCurrentUser();
  redirect(user ? "/dashboard" : "/login");
}
