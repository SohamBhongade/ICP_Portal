"use client";

// Reusable app shell: deep-purple sidebar + topbar + content area.
// Presentational only — pass nav items, title, and user info as props. The
// role dashboards in Phase 6 will reuse this with role-specific nav.
//
// Responsive: sidebar is fixed on >=md; on small screens it becomes a slide-in
// drawer toggled from the topbar (with a dismiss scrim). Active route is
// highlighted via usePathname. Motion is short and disabled under
// prefers-reduced-motion (see globals.css).

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, type LucideIcon } from "lucide-react";

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

type AppShellProps = {
  title: string;
  navItems: NavItem[];
  user: { name: string; role: string };
  /** Optional actions rendered on the right of the topbar. */
  headerActions?: React.ReactNode;
  children: React.ReactNode;
};

const BRAND = "ICP Portal";
const BRAND_SUB = "Imperial College of Pharmacy";

export function AppShell({
  title,
  navItems,
  user,
  headerActions,
  children,
}: AppShellProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const pathname = usePathname();

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  return (
    <div className="min-h-dvh">
      {/* Mobile drawer scrim */}
      {drawerOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
          className="fixed inset-0 z-30 bg-ink/50 md:hidden"
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primary text-primary-foreground transition-transform duration-200 md:translate-x-0 ${
          drawerOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between gap-2 px-5 py-5">
          <div className="flex items-center gap-3">
            <Image
              src="/logo.png"
              alt="Imperial College of Pharmacy Logo"
              width={48}
              height={48}
              className="size-11 shrink-0 rounded-md bg-white/95 object-contain p-1"
              priority
            />
            <div>
              <p className="text-lg font-semibold tracking-tight">{BRAND}</p>
              <p className="text-xs text-primary-foreground/70">{BRAND_SUB}</p>
            </div>
          </div>
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
            className="rounded-md p-1 hover:bg-white/10 md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => setDrawerOpen(false)}
                aria-current={active ? "page" : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                  active
                    ? "bg-white/15 text-white"
                    : "text-primary-foreground/80 hover:bg-white/10 hover:text-white"
                }`}
              >
                <Icon className="size-5 shrink-0" aria-hidden />
                <span>{label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-white/10 px-5 py-4">
          <p className="truncate text-sm font-medium">{user.name}</p>
          <p className="text-xs capitalize text-primary-foreground/70">
            {user.role}
          </p>
        </div>
      </aside>

      {/* Main column */}
      <div className="md:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button
            type="button"
            aria-label="Open menu"
            onClick={() => setDrawerOpen(true)}
            className="rounded-md p-2 text-ink hover:bg-lavender md:hidden"
          >
            <Menu className="size-5" />
          </button>
          <h1 className="flex-1 truncate text-lg font-semibold text-ink">
            {title}
          </h1>
          {headerActions}
        </header>

        <main className="px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
