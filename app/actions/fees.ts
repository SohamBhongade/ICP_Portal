"use server";

// Phase 10 — Fee ledger server actions.
//
// ALL entry points are ADMIN-ONLY, re-verified server-side on every call
// (never trust the client). Students read their own ledger through the server
// component at /student/fees; they never reach a mutation here.
//
//   - fetchStudentLedgerAction: load one student's ledger + computed balances
//   - postFeeTransactionAction: append a single charge / payment row
//
// Balances are always COMPUTED (charges − payments) on the server — see lib/fees.

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { feeLedgers, users } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import {
  computeBalances,
  type FeeBalances,
  type LedgerRow,
  type LedgerType,
} from "@/lib/fees";

/** Returns the admin user, or null if the caller is not an admin. */
async function assertAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "admin") return null;
  return user;
}

export type LedgerStudent = {
  id: number;
  fullName: string;
  studentId: string | null;
  course: string | null;
  className: string | null;
};

export type LedgerResult =
  | { ok: true; student: LedgerStudent; rows: LedgerRow[]; balances: FeeBalances }
  | { ok: false; error: "forbidden" | "notFound" };

export async function fetchStudentLedgerAction(
  studentId: number,
): Promise<LedgerResult> {
  if (!(await assertAdmin())) return { ok: false, error: "forbidden" };

  const [student] = await db
    .select({
      id: users.id,
      fullName: users.fullName,
      studentId: users.studentId,
      course: users.course,
      className: users.className,
      role: users.role,
    })
    .from(users)
    .where(eq(users.id, studentId))
    .limit(1);

  if (!student || student.role !== "student") {
    return { ok: false, error: "notFound" };
  }

  const rows = await db
    .select({
      id: feeLedgers.id,
      date: feeLedgers.date,
      particulars: feeLedgers.particulars,
      type: feeLedgers.type,
      amount: feeLedgers.amount,
      receiptNo: feeLedgers.receiptNo,
    })
    .from(feeLedgers)
    .where(eq(feeLedgers.studentId, studentId))
    .orderBy(asc(feeLedgers.date), asc(feeLedgers.id));

  return {
    ok: true,
    student: {
      id: student.id,
      fullName: student.fullName,
      studentId: student.studentId,
      course: student.course,
      className: student.className,
    },
    rows,
    balances: computeBalances(rows),
  };
}

export type PostTransactionInput = {
  studentId: number;
  type: LedgerType;
  particulars: string;
  amount: number;
  receiptNo?: string;
  date: string; // 'YYYY-MM-DD'
};

export type PostTransactionResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "invalid" };

export async function postFeeTransactionAction(
  input: PostTransactionInput,
): Promise<PostTransactionResult> {
  const admin = await assertAdmin();
  if (!admin) return { ok: false, error: "forbidden" };

  const particulars = input.particulars?.trim();
  const date = input.date?.trim();
  const type = input.type;
  const amount = Number(input.amount);

  if (
    !particulars ||
    !date ||
    (type !== "charge" && type !== "payment") ||
    !Number.isFinite(amount) ||
    amount <= 0
  ) {
    return { ok: false, error: "invalid" };
  }

  // Confirm the target is really a student before writing.
  const [student] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, input.studentId))
    .limit(1);
  if (!student || student.role !== "student") {
    return { ok: false, error: "invalid" };
  }

  await db.insert(feeLedgers).values({
    studentId: input.studentId,
    particulars,
    type,
    amount,
    receiptNo: input.receiptNo?.trim() || null,
    date,
    recordedBy: admin.id,
  });

  revalidatePath("/admin/fees");
  revalidatePath("/student/fees");
  revalidatePath("/admin");
  revalidatePath("/student");
  return { ok: true };
}
