"use client";

// Role-aware dashboard shell. Server layouts pass only plain data (role + user);
// the icon components and nav config live here (client) because functions can't
// cross the server→client boundary as props. Renders AppShell with translated
// nav labels, header language switcher + logout, and a title derived from the
// active route.

import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  UserPlus,
  Users,
  CalendarCheck,
  ClipboardList,
  Wallet,
  LifeBuoy,
  Settings,
  type LucideIcon,
} from "lucide-react";
import { AppShell, type NavItem } from "./AppShell";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { EditModeToggle } from "@/components/edit-mode/EditModeToggle";
import { useT } from "@/components/i18n/LanguageProvider";
import type { Role } from "@/lib/auth/session";
import { capabilitiesFor, type Capability } from "@/lib/auth/permissions";

type NavConfig = {
  href: string;
  key: string;
  icon: LucideIcon;
  // Predicate over the role's capabilities → whether this item is shown.
  show: (caps: readonly Capability[]) => boolean;
};

const has = (caps: readonly Capability[], c: Capability) => caps.includes(c);

// Staff console nav. Every item is derived from the shared capability matrix, so
// a role sees exactly the actions it is authorised for — nothing to hide by hand.
const STAFF_NAV: NavConfig[] = [
  {
    href: "/admin",
    key: "overview",
    icon: LayoutDashboard,
    show: (c) => has(c, "manageUsers") || has(c, "fees") || has(c, "settings"),
  },
  { href: "/admin/requests", key: "requests", icon: UserPlus, show: (c) => has(c, "manageUsers") },
  { href: "/admin/users", key: "users", icon: Users, show: (c) => has(c, "manageUsers") },
  { href: "/teacher/attendance", key: "recordAttendance", icon: CalendarCheck, show: (c) => has(c, "attendance") },
  { href: "/admin/attendance", key: "attendanceOverview", icon: ClipboardList, show: (c) => has(c, "settings") },
  { href: "/admin/fees", key: "fees", icon: Wallet, show: (c) => has(c, "fees") },
  { href: "/admin/support", key: "support", icon: LifeBuoy, show: (c) => has(c, "settings") },
  { href: "/admin/settings", key: "settings", icon: Settings, show: (c) => has(c, "settings") },
];

// Students have their own fixed console (no staff capabilities).
const STUDENT_NAV: NavConfig[] = [
  { href: "/student", key: "overview", icon: LayoutDashboard, show: () => true },
  { href: "/student/attendance", key: "attendance", icon: CalendarCheck, show: () => true },
  { href: "/student/fees", key: "fees", icon: Wallet, show: () => true },
  { href: "/student/support", key: "support", icon: LifeBuoy, show: () => true },
];

function navForRole(role: Role): NavConfig[] {
  if (role === "student") return STUDENT_NAV;
  const caps = capabilitiesFor(role);
  return STAFF_NAV.filter((item) => item.show(caps));
}

export function DashboardShell({
  role,
  user,
  children,
}: {
  role: Role;
  user: { name: string };
  children: React.ReactNode;
}) {
  const t = useT();
  const pathname = usePathname();

  const config = navForRole(role);
  const navItems: NavItem[] = config.map((item) => ({
    href: item.href,
    label: t(`nav.${item.key}`),
    icon: item.icon,
  }));

  // Title = label of the most specific (longest matching href) active nav item.
  const active = config
    .filter((c) => pathname === c.href || pathname.startsWith(c.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
  const title = active ? t(`nav.${active.key}`) : t("nav.overview");

  return (
    <AppShell
      title={title}
      navItems={navItems}
      user={{ name: user.name, role }}
      headerActions={
        <div className="flex items-center gap-3">
          <EditModeToggle />
          <LogoutButton />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
