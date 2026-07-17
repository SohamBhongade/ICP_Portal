// Central RBAC model — the SINGLE SOURCE OF TRUTH for the authorization matrix.
//
// This file is intentionally PURE and Edge-safe: no DB, no "server-only", no
// Node APIs. That lets every layer share the exact same rules —
//   - proxy.ts          (Edge runtime, optimistic route gating)
//   - server actions    (Node runtime, authoritative mutation guards)
//   - server components  (page-level guards)
//   - client components  (hide/disable UI a role can't use)
// so the matrix can never drift apart between UI and enforcement.
//
// University matrix (Phase 2):
//   role          settings  manageUsers  deleteUsers  fees  attendance
//   admin            ✓           ✓            ✓         ✓        ✓
//   principle        ✓           ✓            ✗         ✓        ✓
//   office admin     ✗           ✓            ✗         ✓        ✗
//   faculty          ✗           ✗            ✗         ✗        ✓
//   staff            ✗           ✗            ✗         ✗        ✓
//   student          — (no staff-console access)

export type Role =
  | "admin"
  | "office admin"
  | "principle"
  | "staff"
  | "faculty"
  | "student";

// The atomic permissions the matrix is expressed in.
export type Capability =
  | "settings" // view Settings + Edit Mode (dropdowns / text overrides)
  | "manageUsers" // add users + review account requests
  | "deleteUsers" // permanently delete a user (admin only)
  | "fees" // view + post fee-ledger transactions
  | "attendance"; // record attendance

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: ["settings", "manageUsers", "deleteUsers", "fees", "attendance"],
  principle: ["settings", "manageUsers", "fees", "attendance"],
  "office admin": ["manageUsers", "fees"],
  faculty: ["attendance"],
  staff: ["attendance"],
  student: [],
};

export function capabilitiesFor(role: Role): readonly Capability[] {
  return ROLE_CAPABILITIES[role] ?? [];
}

/** Does `role` hold `capability`? Null-safe for optional session roles. */
export function can(
  role: Role | null | undefined,
  capability: Capability,
): boolean {
  if (!role) return false;
  return capabilitiesFor(role).includes(capability);
}

/** Does `role` hold ANY of the listed capabilities? */
export function canAny(
  role: Role | null | undefined,
  ...capabilities: Capability[]
): boolean {
  return capabilities.some((c) => can(role, c));
}

// Anti-escalation ranking for user creation. A user may only mint accounts of
// STRICTLY lower rank than themselves (admins may also mint fellow admins), so
// an Office Admin can never create a Principle/Admin, etc.
const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  principle: 3,
  "office admin": 2,
  faculty: 1,
  staff: 1,
  student: 0,
};

/** Roles a `creator` is allowed to assign when creating/onboarding a user. */
export function assignableRoles(creator: Role): Role[] {
  const rank = ROLE_RANK[creator] ?? 0;
  return (Object.keys(ROLE_RANK) as Role[]).filter((target) =>
    creator === "admin" ? true : ROLE_RANK[target] < rank,
  );
}

/** Authoritative check for the create-user path. */
export function canAssignRole(creator: Role, target: Role): boolean {
  return assignableRoles(creator).includes(target);
}

/** Every non-student role uses the staff console. */
export function isStaffRole(role: Role): boolean {
  return role !== "student";
}

// ---- Route model (shared by proxy + page guards) ----

// Longest-prefix-wins map of staff-console sub-routes to the capability each
// one requires. Order matters: more specific prefixes are listed first.
const ADMIN_ROUTE_CAPS: { prefix: string; capability: Capability }[] = [
  { prefix: "/admin/settings", capability: "settings" },
  { prefix: "/admin/support", capability: "settings" },
  { prefix: "/admin/attendance", capability: "settings" }, // read-only monitoring (management view)
  { prefix: "/admin/requests", capability: "manageUsers" },
  { prefix: "/admin/users", capability: "manageUsers" },
  { prefix: "/admin/fees", capability: "fees" },
];

/**
 * Post-login home for a role. Keeps proxy + /dashboard in agreement so users
 * always land somewhere they're actually allowed to be.
 */
export function landingPath(role: Role): string {
  if (role === "student") return "/student";
  if (canAny(role, "manageUsers", "fees", "settings")) return "/admin";
  if (can(role, "attendance")) return "/teacher/attendance";
  return "/login";
}

/**
 * Optimistic route authorization used by proxy.ts. Authoritative checks still
 * run in every server action + sensitive page guard.
 */
export function canAccessPath(role: Role, pathname: string): boolean {
  // Attendance recorder console (Faculty/Staff/Principle/Admin).
  if (pathname === "/teacher" || pathname.startsWith("/teacher/")) {
    return can(role, "attendance");
  }
  // Management console.
  if (pathname === "/admin" || pathname.startsWith("/admin/")) {
    const rule = ADMIN_ROUTE_CAPS.find((r) => pathname.startsWith(r.prefix));
    if (rule) return can(role, rule.capability);
    // /admin root (overview) + anything unmapped: any management capability.
    return canAny(role, "manageUsers", "fees", "settings");
  }
  // Student area: students, plus admins for support/preview.
  if (pathname === "/student" || pathname.startsWith("/student/")) {
    return role === "student" || role === "admin";
  }
  // /dashboard and everything else: any authenticated user.
  return true;
}
