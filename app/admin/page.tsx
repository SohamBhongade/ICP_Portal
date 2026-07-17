// Admin overview (Phase 12 / Phase 3 overhaul) — live metrics.
//
// Server component: a SINGLE grouped aggregation (active students by course +
// class/year) supplies both the headline "Active students" total and the
// course/year breakdown widget. Fees-collected and active-tickets widgets were
// removed in Phase 3.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAnyCapability } from "@/lib/auth";
import { AdminOverview, type StudentBreakdown } from "./AdminOverview";

// Normalize free-text course/class values to compare regardless of spacing,
// punctuation, or case ("B.Pharm", "b pharm", "BPHARM" → "bpharm"). This keeps
// the dashboard correct even before Phase 4's CSV normalization lands.
const norm = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

function courseKey(course: string | null): "bpharm" | "dpharm" | null {
  const c = norm(course);
  if (c.startsWith("bpharm")) return "bpharm";
  if (c.startsWith("dpharm")) return "dpharm";
  return null;
}

function yearKey(className: string | null): "year1" | "year2" | null {
  const c = norm(className);
  if (c.includes("first") || c.includes("1")) return "year1";
  if (c.includes("second") || c.includes("2")) return "year2";
  return null;
}

export default async function AdminDashboardPage() {
  await requireAnyCapability("manageUsers", "fees", "settings");

  // Aggregate in SQL: one row per (course, class) with its active-student count.
  const groups = await db
    .select({
      course: users.course,
      className: users.className,
      count: sql<number>`count(*)`,
    })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.status, "active")))
    .groupBy(users.course, users.className);

  // Bucket the grouped rows into the course × year breakdown.
  const breakdown: StudentBreakdown = {
    bpharm: { total: 0, year1: 0, year2: 0 },
    dpharm: { total: 0, year1: 0, year2: 0 },
  };
  let activeStudents = 0;
  for (const g of groups) {
    const n = Number(g.count);
    activeStudents += n;
    const ck = courseKey(g.course);
    if (!ck) continue;
    breakdown[ck].total += n;
    const yk = yearKey(g.className);
    if (yk) breakdown[ck][yk] += n;
  }

  return (
    <AdminOverview activeStudents={activeStudents} breakdown={breakdown} />
  );
}
