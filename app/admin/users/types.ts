// Shared types for the Admin > Users feature.
//
// These live in their own module (rather than in UsersContent) so the table,
// the drawers, and the CSV import can import them without pulling the whole
// client orchestrator into their module graph.

import type { Role } from "@/lib/auth/permissions";
export type { CustomField } from "@/lib/user-fields";

export type UserRow = {
  id: number;
  fullName: string;
  studentId: string | null;
  email: string | null;
  phone: string | null;
  role: Role;
  course: string | null;
  className: string | null;
  practicalBatch: string | null;
  status: "pending" | "active" | "rejected";
  // Joined date — a Date across the RSC boundary, but tolerate string/number.
  createdAt: Date | string | number | null;
  // Values for the admin-defined columns (Phase 9), keyed by FIELD KEY — not by
  // the `custom:` layout key. Absent means "no value", which is a normal state
  // for every row, so this is always present but often empty.
  custom: Record<string, string>;
};

export type ToastKind = "success" | "error";
export type Toast = { id: number; kind: ToastKind; message: string };

export const ROLE_LABEL: Record<Role, string> = {
  admin: "onboarding.roleAdmin",
  principal: "onboarding.rolePrincipal",
  "office admin": "onboarding.roleOfficeAdmin",
  faculty: "onboarding.roleFaculty",
  staff: "onboarding.roleStaff",
  student: "onboarding.roleStudent",
};

export const STATUS_LABEL: Record<UserRow["status"], string> = {
  active: "onboarding.statusActive",
  pending: "onboarding.statusPending",
  rejected: "onboarding.statusRejected",
};

export const STATUS_STYLE: Record<UserRow["status"], string> = {
  active: "bg-mint text-teal",
  pending: "bg-lavender text-primary",
  rejected: "bg-lavender text-danger",
};
