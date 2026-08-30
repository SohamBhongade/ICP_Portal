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
// University matrix (Phase 2 hardening — see ENFORCEMENT MATRIX below):
//   role          settings  createUsers  manageUsers  approveRequests  deleteUsers  feeWrites  fees  attendance  attendanceBackdate
//   admin            ✓           ✓            ✓              ✓              ✓          ✓        ✓        ✓            ✓
//   principal        ✗           ✗            ✗              ✗              ✗          ✓        ✓        ✓            ✗
//   office admin     ✗           ✗            ✗              ✗              ✗          ✓        ✓        ✗            ✗
//   faculty          ✗           ✗            ✗              ✗              ✗          ✗        ✗        ✓            ✗
//   staff            ✗           ✗            ✗              ✗              ✗          ✗        ✗        ✓            ✗
//   student          — (no staff-console access; reads only their OWN records)
//
// ENFORCEMENT MATRIX (the Phase 2 requirement this table encodes):
//   Fee writes                -> admin, principal, office admin   (feeWrites)
//   User create/edit/delete   -> admin only            (createUsers/manageUsers/deleteUsers)
//   Account approve/reject    -> admin only            (approveRequests)
//   Dropdown/settings edits   -> admin only            (settings)
//   Edit Mode toggle          -> admin only            (settings)
//   Attendance marking        -> teacher or admin      (attendance)
//   Attendance edits of past  -> admin only            (attendanceBackdate)
//   Student data reads        -> owning student, or teacher/admin
//                                (canReadStudentData below)
//
// NOTE on the read/write split: `fees` grants access to the fee console, while
// `feeWrites` gates posting a transaction. They currently cover the same three
// roles, but staying separate means a view-only role can be added later without
// touching a single call site. Same idea for attendance: `attendance` marks
// TODAY, `attendanceBackdate` is what lets anyone touch a past date.

export type Role =
  | "admin"
  | "office admin"
  | "principal"
  | "staff"
  | "faculty"
  | "student";

// The atomic permissions the matrix is expressed in.
export type Capability =
  | "settings" // edit Settings, dropdowns, text overrides + Edit Mode toggle
  | "createUsers" // mint a NEW account directly (manual add / CSV)
  | "manageUsers" // edit existing users in the Users console
  | "approveRequests" // accept/reject pending self-service account requests
  | "deleteUsers" // permanently delete a user
  | "fees" // VIEW the fee console / read any student's ledger
  | "feeWrites" // POST a fee-ledger transaction (charge / payment)
  | "attendance" // record attendance for the current day
  | "attendanceBackdate"; // mark or amend attendance for a PAST date

const ROLE_CAPABILITIES: Record<Role, readonly Capability[]> = {
  admin: [
    "settings",
    "createUsers",
    "manageUsers",
    "approveRequests",
    "deleteUsers",
    "fees",
    "feeWrites",
    "attendance",
    "attendanceBackdate",
  ],
  // Fee posting is shared: Admin, Principal and Office Admin may all write to a
  // ledger. User management is admin-exclusive; attendance is Admin, Principal,
  // Faculty and Staff.
  principal: ["fees", "feeWrites", "attendance"],
  "office admin": ["fees", "feeWrites"],
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
// an Office Admin can never create a Principal/Admin, etc.
const ROLE_RANK: Record<Role, number> = {
  admin: 4,
  principal: 3,
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

/**
 * Ownership gate for any READ that accepts a student id from the URL or a
 * request payload (attendance, fees, tickets).
 *
 * Allowed when the caller IS that student, or when they hold a staff capability
 * over student records (`fees` for ledgers, `attendance` for rosters/logs).
 * Everyone else is denied — so a student swapping the id in a payload can only
 * ever address their own row.
 *
 * Pure and Edge-safe like the rest of this file: the caller passes the id and
 * role it already verified from the SESSION, never from the request.
 */
export function canReadStudentData(
  actor: { id: number; role: Role },
  targetStudentId: number,
): boolean {
  if (actor.id === targetStudentId) return true;
  return canAny(actor.role, "fees", "attendance");
}

// ---- Route model (shared by proxy + page guards) ----

// Longest-prefix-wins map of staff-console sub-routes to the capability each
// one requires. Order matters: more specific prefixes are listed first.
const ADMIN_ROUTE_CAPS: { prefix: string; capability: Capability }[] = [
  { prefix: "/admin/settings", capability: "settings" },
  { prefix: "/admin/support", capability: "settings" },
  { prefix: "/admin/attendance", capability: "settings" }, // read-only monitoring (management view)
  { prefix: "/admin/fees", capability: "fees" },
  { prefix: "/admin/requests", capability: "approveRequests" },
  { prefix: "/admin/users", capability: "manageUsers" },
];

/**
 * Post-login home for a role. Keeps proxy + /dashboard in agreement so users
 * always land somewhere they're actually allowed to be.
 */
export function landingPath(role: Role): string {
  if (role === "student") return "/student";
  if (canAny(role, "manageUsers", "fees", "settings")) return "/admin";
  // (attendance-only roles fall through to the recorder console below)
  if (can(role, "attendance")) return "/teacher/attendance";
  return "/login";
}

/**
 * Optimistic route authorization used by proxy.ts. Authoritative checks still
 * run in every server action + sensitive page guard.
 */
export function canAccessPath(role: Role, pathname: string): boolean {
  // Attendance recorder console (Faculty/Staff/Principal/Admin).
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
