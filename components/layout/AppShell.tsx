"use client";

// Reusable app shell: deep-purple sidebar + topbar + content area.
// Presentational only — pass nav items, title, and user info as props. The
// role dashboards in Phase 6 will reuse this with role-specific nav.
//
// Responsive: sidebar is fixed on >=md; on small screens it becomes a slide-in
// drawer toggled from the topbar (with a dismiss scrim). Active route is
// highlighted via usePathname. Motion is short and disabled under
// prefers-reduced-motion (see globals.css).
//
// Z-INDEX SCALE (the whole app; keep these in step)
//   20  sticky page header
//   30  mobile drawer scrim
//   40  sidebar / drawer
//   50  modal dialogs and slide-over panels
//   60  toasts (must clear a modal, since a modal can raise one)
//  100  post-login splash (components/splash)
// Two layers previously shared 40, which only worked because the modal happened
// to sit later in the DOM. Anything that reordered them would have let the
// sidebar punch through a modal overlay.
//
// MOBILE DRAWER ACCESSIBILITY: a closed drawer hidden only with a transform is
// still in the tab order and still announced by screen readers. The fix is
// `visibility: hidden` (Tailwind `invisible`), applied below — see the note on
// the <aside>.

import { useEffect, useRef, useState } from "react";
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

  // Where focus came from, so it can be handed back when the drawer closes.
  const openerRef = useRef<HTMLButtonElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);

  const isActive = (href: string) =>
    pathname === href || pathname.startsWith(href + "/");

  // Escape closes the drawer. Without this a keyboard user can open the menu
  // and then has no way out except tabbing to the X.
  useEffect(() => {
    if (!drawerOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDrawerOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [drawerOpen]);

  // Lock the page behind the open drawer. Without it, dragging on the scrim
  // scrolls the content underneath, which reads as the drawer being broken.
  useEffect(() => {
    if (!drawerOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [drawerOpen]);

  // Move focus into the drawer on open, and return it to the hamburger on
  // close, so keyboard focus is never stranded on a now-hidden element.
  //
  // `wasOpen` guards the close branch: without it this effect also fires on
  // MOUNT (drawerOpen starts false) and would yank focus to the hamburger on
  // every single page load.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (drawerOpen) {
      drawerRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    } else if (wasOpen.current) {
      openerRef.current?.focus({ preventScroll: true });
    }
    wasOpen.current = drawerOpen;
  }, [drawerOpen]);


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
        ref={drawerRef}
        id="app-sidebar"
        aria-label={BRAND}
        // ACCESSIBILITY: `-translate-x-full` alone only moves the drawer out of
        // SIGHT. It stays in the tab order and in the accessibility tree, so on
        // a phone Tab walks through eight invisible links and a screen reader
        // announces a menu that is not on screen.
        //
        // `invisible` (visibility: hidden) is what actually removes it from
        // both, and unlike `inert` it needs no JavaScript — so the drawer is
        // correct on the very first paint, before hydration, and there is no
        // viewport guess for the server to get wrong.
        //
        // `md:visible` re-exposes it at >=768px, where it is a permanent
        // sidebar rather than a drawer.
        //
        // visibility is included in the transition so it flips at the END of
        // the slide-out (CSS transitions treat it discretely) — without that,
        // the drawer would blink out of existence instead of sliding away.
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primary text-primary-foreground transition-[transform,visibility] duration-200 md:visible md:translate-x-0 ${
          drawerOpen ? "visible translate-x-0" : "invisible -translate-x-full"
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
            ref={openerRef}
            type="button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen(true)}
            className="cursor-pointer rounded-md p-2 text-ink hover:bg-lavender md:hidden"
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
