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
  Wallet,
  LifeBuoy,
  Settings,
  BarChart3,
  type LucideIcon,
} from "lucide-react";
import { AppShell, type NavItem } from "./AppShell";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { LogoutButton } from "@/components/auth/LogoutButton";
import { EditModeToggle } from "@/components/edit-mode/EditModeToggle";
import { useT } from "@/components/i18n/LanguageProvider";
import type { Role } from "@/lib/auth/session";

type NavConfig = { href: string; key: string; icon: LucideIcon };

const NAV: Record<Role, NavConfig[]> = {
  admin: [
    { href: "/admin", key: "overview", icon: LayoutDashboard },
    { href: "/admin/requests", key: "requests", icon: UserPlus },
    { href: "/admin/users", key: "users", icon: Users },
    { href: "/admin/attendance", key: "attendance", icon: CalendarCheck },
    { href: "/admin/fees", key: "fees", icon: Wallet },
    { href: "/admin/support", key: "support", icon: LifeBuoy },
    { href: "/admin/settings", key: "settings", icon: Settings },
  ],
  teacher: [
    { href: "/teacher", key: "overview", icon: LayoutDashboard },
    { href: "/teacher/attendance", key: "attendance", icon: CalendarCheck },
    { href: "/teacher/analytics", key: "analytics", icon: BarChart3 },
  ],
  student: [
    { href: "/student", key: "overview", icon: LayoutDashboard },
    { href: "/student/attendance", key: "attendance", icon: CalendarCheck },
    { href: "/student/fees", key: "fees", icon: Wallet },
    { href: "/student/support", key: "support", icon: LifeBuoy },
  ],
};

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

  const config = NAV[role];
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
          <LanguageSwitcher variant="compact" />
          <LogoutButton />
        </div>
      }
    >
      {children}
    </AppShell>
  );
}
