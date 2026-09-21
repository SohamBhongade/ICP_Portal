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
// DESKTOP AUTO-HIDE (>= md): the sidebar is tucked away off the left edge so
// pages like the Users grid get the full screen width. Moving the pointer to
// the left edge of the screen slides it out over the content; moving away
// tucks it back after a short delay. The pin button inside the sidebar keeps
// it open permanently (remembered per browser), which restores the old
// always-visible layout. Keyboard users get the same sidebar from the menu
// button in the header, and tabbing into it also reveals it.
//
// MOBILE DRAWER ACCESSIBILITY: a closed drawer hidden only with a transform is
// still in the tab order and still announced by screen readers. The fix is
// `visibility: hidden` (Tailwind `invisible`), applied below — see the note on
// the <aside>.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, Pin, PinOff, X, type LucideIcon } from "lucide-react";

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

/** localStorage key for the "keep sidebar open" pin. Per-browser convenience. */
const PIN_STORAGE_KEY = "icp.sidebarPinned";
/** Delay before a hover-revealed sidebar tucks away again, so a pointer that
 *  briefly overshoots its edge doesn't make it flicker. */
const HIDE_DELAY_MS = 300;

// The pin lives in localStorage and is read through useSyncExternalStore, so
// the server render (no storage) and the first client render agree — no
// hydration mismatch — and the saved value takes over right after. Storage can
// be missing or throw (private mode, blocked site data); auto-hide is the
// fallback in every such case.
const PIN_EVENT = "icp:sidebar-pin";
function readPinned(): boolean {
  try {
    return window.localStorage.getItem(PIN_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}
function writePinned(value: boolean) {
  try {
    window.localStorage.setItem(PIN_STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* storage unavailable: the pin just won't persist */
  }
  window.dispatchEvent(new Event(PIN_EVENT));
}
function subscribePinned(onChange: () => void) {
  window.addEventListener(PIN_EVENT, onChange);
  window.addEventListener("storage", onChange); // other tabs
  return () => {
    window.removeEventListener(PIN_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

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

  // Desktop auto-hide state. `pinned` restores a permanently visible sidebar;
  // `peek` is the temporary hover/focus reveal.
  const pinned = useSyncExternalStore(subscribePinned, readPinned, () => false);
  const [peek, setPeek] = useState(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const togglePinned = () => {
    writePinned(!pinned);
    setPeek(false);
  };

  const cancelHide = useCallback(() => {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }, []);
  const showPeek = useCallback(() => {
    cancelHide();
    setPeek(true);
  }, [cancelHide]);
  const hidePeekSoon = useCallback(() => {
    cancelHide();
    hideTimer.current = setTimeout(() => setPeek(false), HIDE_DELAY_MS);
  }, [cancelHide]);
  useEffect(() => cancelHide, [cancelHide]);

  // On desktop the sidebar is on screen when pinned, peeking, or opened from
  // the header menu button.
  const desktopOpen = pinned || peek || drawerOpen;

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
          className={`fixed inset-0 z-30 bg-ink/50 ${pinned ? "md:hidden" : "md:bg-ink/20"}`}
        />
      )}

      {/* Desktop hot zone: a thin strip along the left edge. Touching it with
          the pointer slides the sidebar out. Absent when pinned. */}
      {!pinned && !desktopOpen && (
        <div
          aria-hidden
          onMouseEnter={showPeek}
          className="fixed inset-y-0 left-0 z-40 hidden w-2 md:block"
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
        //
        // On desktop the same classes are driven by `desktopOpen` instead
        // (pinned / hover-peek / menu button), so a tucked-away sidebar is
        // equally out of the tab order.
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-primary text-primary-foreground transition-[transform,visibility,box-shadow] duration-200 ${
          drawerOpen ? "visible translate-x-0" : "invisible -translate-x-full"
        } ${
          desktopOpen
            ? "md:visible md:translate-x-0"
            : "md:invisible md:-translate-x-full"
        } ${!pinned && desktopOpen ? "md:shadow-2xl" : ""}`}
        onMouseEnter={pinned ? undefined : showPeek}
        onMouseLeave={pinned ? undefined : hidePeekSoon}
        onFocus={pinned ? undefined : showPeek}
        onBlur={
          pinned
            ? undefined
            : (e) => {
                // Only tuck away once focus has left the sidebar entirely.
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                  hidePeekSoon();
                }
              }
        }
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
          {/* Desktop only: keep the sidebar open instead of auto-hiding. */}
          <button
            type="button"
            onClick={togglePinned}
            aria-pressed={pinned}
            aria-label={pinned ? "Auto-hide sidebar" : "Keep sidebar open"}
            title={pinned ? "Auto-hide sidebar" : "Keep sidebar open"}
            className="hidden shrink-0 cursor-pointer rounded-md p-1.5 text-primary-foreground/80 hover:bg-white/10 hover:text-white md:inline-flex"
          >
            {pinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-2">
          {navItems.map(({ href, label, icon: Icon }) => {
            const active = isActive(href);
            return (
              <Link
                key={href}
                href={href}
                onClick={() => {
                  // Following a link tucks a drawer / peeking sidebar away.
                  setDrawerOpen(false);
                  setPeek(false);
                }}
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

      {/* Main column. Only a PINNED sidebar reserves space; a peeking one
          slides over the content instead of shoving the page sideways. */}
      <div
        className={`transition-[padding] duration-200 ${pinned ? "md:pl-64" : ""}`}
      >
        <header className="sticky top-0 z-20 flex h-[var(--app-header-h)] items-center gap-3 border-b border-line bg-surface/90 px-4 backdrop-blur sm:px-6">
          <button
            ref={openerRef}
            type="button"
            aria-label="Open menu"
            aria-expanded={drawerOpen}
            aria-controls="app-sidebar"
            onClick={() => setDrawerOpen(true)}
            className={`cursor-pointer rounded-md p-2 text-ink hover:bg-lavender ${
              pinned ? "md:hidden" : ""
            }`}
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
