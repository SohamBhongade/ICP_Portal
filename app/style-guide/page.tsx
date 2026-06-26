"use client";

// Phase 3 demo page — proves the pharma theme tokens render correctly through
// the AppShell. Everything here uses TOKEN utilities (bg-primary, text-ink,
// bg-lavender, text-teal, etc.), never raw hex. This page is temporary scaffolding
// and will be removed once real dashboards exist.

import {
  LayoutDashboard,
  Users,
  CalendarCheck,
  Wallet,
  Megaphone,
  LifeBuoy,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import { AppShell, type NavItem } from "@/components/layout/AppShell";

const navItems: NavItem[] = [
  { href: "/style-guide", label: "Style Guide", icon: LayoutDashboard },
  { href: "/style-guide/users", label: "Users", icon: Users },
  { href: "/style-guide/attendance", label: "Attendance", icon: CalendarCheck },
  { href: "/style-guide/fees", label: "Fees", icon: Wallet },
  { href: "/style-guide/circulars", label: "Circulars", icon: Megaphone },
  { href: "/style-guide/support", label: "Support", icon: LifeBuoy },
];

const swatches: { name: string; className: string; token: string }[] = [
  { name: "Primary", className: "bg-primary", token: "--primary" },
  { name: "Primary Hover", className: "bg-primary-hover", token: "--primary-hover" },
  { name: "Teal", className: "bg-teal", token: "--teal" },
  { name: "Teal Light", className: "bg-teal-light", token: "--teal-light" },
  { name: "Lavender", className: "bg-lavender", token: "--lavender" },
  { name: "Mint", className: "bg-mint", token: "--mint" },
  { name: "Canvas", className: "bg-canvas", token: "--canvas" },
  { name: "Surface", className: "bg-surface", token: "--surface" },
  { name: "Ink", className: "bg-ink", token: "--ink" },
  { name: "Present", className: "bg-chart-present", token: "--chart-present" },
  { name: "Absent", className: "bg-chart-absent", token: "--chart-absent" },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <h2 className="mb-4 text-base font-semibold text-ink">{title}</h2>
      {children}
    </section>
  );
}

export default function StyleGuidePage() {
  return (
    <AppShell
      title="Style Guide"
      navItems={navItems}
      user={{ name: "Demo Admin", role: "admin" }}
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <p className="text-sm text-muted">
          Phase 3 theme proof — every element below is styled with semantic
          tokens defined in <code className="font-mono">globals.css</code>.
        </p>

        {/* Color tokens */}
        <Section title="Color tokens">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {swatches.map((s) => (
              <div
                key={s.name}
                className="overflow-hidden rounded-md border border-line"
              >
                <div className={`h-16 w-full ${s.className}`} />
                <div className="px-3 py-2">
                  <p className="text-sm font-medium text-ink">{s.name}</p>
                  <p className="font-mono text-xs text-muted">{s.token}</p>
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* Buttons */}
        <Section title="Buttons">
          <div className="flex flex-wrap items-center gap-3">
            <button className="cursor-pointer rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover">
              Primary action
            </button>
            <button className="cursor-pointer rounded-md bg-teal px-4 py-2 text-sm font-medium text-teal-foreground transition-colors hover:bg-teal-light">
              Confirm
            </button>
            <button className="cursor-pointer rounded-md border border-primary px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-lavender">
              Secondary
            </button>
            <button
              disabled
              className="cursor-not-allowed rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground opacity-50"
            >
              Disabled
            </button>
          </div>
        </Section>

        {/* Badges / status */}
        <Section title="Status badges">
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-mint px-3 py-1 text-sm font-medium text-teal">
              <CheckCircle2 className="size-4" aria-hidden /> Present
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-lavender px-3 py-1 text-sm font-medium text-chart-absent">
              <XCircle className="size-4" aria-hidden /> Absent
            </span>
            <span className="rounded-full bg-lavender px-3 py-1 text-sm font-medium text-primary">
              Pending
            </span>
            <span className="rounded-full bg-mint px-3 py-1 text-sm font-medium text-teal">
              Active
            </span>
          </div>
        </Section>

        {/* Cards on accent surfaces */}
        <Section title="Accent surfaces">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg bg-lavender p-4">
              <p className="text-sm font-medium text-primary">Lavender card</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                128
              </p>
              <p className="text-sm text-muted">Total students</p>
            </div>
            <div className="rounded-lg bg-mint p-4">
              <p className="text-sm font-medium text-teal">Mint card</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
                92%
              </p>
              <p className="text-sm text-muted">Average attendance</p>
            </div>
          </div>
        </Section>

        {/* Sample form field */}
        <Section title="Form input">
          <div className="max-w-sm">
            <label
              htmlFor="demo-input"
              className="mb-1 block text-sm font-medium text-ink"
            >
              Full name
            </label>
            <input
              id="demo-input"
              type="text"
              placeholder="e.g. Aarav Patil"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-teal"
            />
            <p className="mt-1 text-xs text-muted">
              Helper text uses the muted token.
            </p>
          </div>
        </Section>
      </div>
    </AppShell>
  );
}
