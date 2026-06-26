// Public self-service account request (Phase 8 — onboarding tail).
//
// Server component: loads the Course / Class / Practical-batch dropdown options
// (public, non-sensitive) and hands them to the client form. The form posts to
// requestAccountAction, creating a status='pending' student for admin review.

import type { Metadata } from "next";
import { getDropdownOptions } from "@/lib/edit-mode/settings";
import { RequestAccountForm } from "./RequestAccountForm";

export const metadata: Metadata = { title: "Request an account" };

export default async function RequestAccountPage() {
  const [courseOpts, classOpts, batchOpts] = await Promise.all([
    getDropdownOptions("course"),
    getDropdownOptions("class"),
    getDropdownOptions("practical_batch"),
  ]);

  const toItems = (opts: { value: string; label: string }[]) =>
    opts.map((o) => ({ value: o.value, label: o.label }));

  return (
    <RequestAccountForm
      courseOptions={toItems(courseOpts)}
      classOptions={toItems(classOpts)}
      batchOptions={toItems(batchOpts)}
    />
  );
}
