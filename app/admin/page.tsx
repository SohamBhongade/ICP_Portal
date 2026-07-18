// Admin overview (Phase 12 / Phase 3 overhaul) — live metrics.
//
// Server component: a SINGLE grouped aggregation (active students by course +
// year) supplies both the headline "Active students" total and the course/year
// breakdown widget. The breakdown is fully DYNAMIC — it groups over whatever
// course/year values actually exist, so new programmes (M.Pharm, BCA, …) and
// years appear automatically with no code change.

import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { requireAnyCapability } from "@/lib/auth";
import { AdminOverview, type StudentBreakdown } from "./AdminOverview";

export default async function AdminDashboardPage() {
  await requireAnyCapability("manageUsers", "fees", "settings");

  // Aggregate in SQL: one row per (course, year) with its active-student count.
  const groups = await db
    .select({
      course: users.course,
      year: users.year,
      count: sql<number>`count(*)`,
    })
    .from(users)
    .where(and(eq(users.role, "student"), eq(users.status, "active")))
    .groupBy(users.course, users.year);

  // Fold the grouped rows into a dynamic per-course breakdown. Course values are
  // already canonical (lib/courses), so we group on them as-is.
  const byCourse = new Map<
    string,
    { total: number; years: Map<number, number> }
  >();
  let activeStudents = 0;

  for (const g of groups) {
    const n = Number(g.count);
    activeStudents += n;
    if (!g.course) continue; // students without a course still count in the total
    const entry = byCourse.get(g.course) ?? { total: 0, years: new Map() };
    entry.total += n;
    if (g.year != null) {
      entry.years.set(g.year, (entry.years.get(g.year) ?? 0) + n);
    }
    byCourse.set(g.course, entry);
  }

  const breakdown: StudentBreakdown = [...byCourse.entries()]
    .map(([course, v]) => {
      const years = [...v.years.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year);
      const knownYear = years.reduce((sum, y) => sum + y.count, 0);
      return {
        course,
        total: v.total,
        years,
        // Students in this course whose year is unset — so the numbers reconcile.
        unspecified: v.total - knownYear,
      };
    })
    // Biggest cohorts first, then alphabetical for stable ordering.
    .sort((a, b) => b.total - a.total || a.course.localeCompare(b.course));

  return <AdminOverview activeStudents={activeStudents} breakdown={breakdown} />;
}
