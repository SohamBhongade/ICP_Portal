"use server";

// Phase 10 — Fee ledger server actions.
//
// Authorization is split READ vs WRITE, and re-verified server-side at the top
// of every call (never trust the client):
//
//   - fetchStudentLedgerAction: READ one student's ledger + computed balances.
//     Takes a student id from the caller, so it is ownership-checked: the
//     OWNING student, or a staff role holding `fees`/`attendance`. A student
//     swapping the id for someone else's gets `forbidden`.
//   - postFeeTransactionAction: WRITE a charge / payment row, gated by the
//     `feeWrites` capability — Admin, Principal and Office Admin.
//
// Balances are always COMPUTED (charges − payments) on the server — see lib/fees.

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { feeLedgers, users } from "@/db/schema";
import { currentUserWithCapability, getCurrentUser } from "@/lib/auth";
import { canReadStudentData, type Role } from "@/lib/auth/permissions";
import { logServerError } from "@/lib/errors";
import { parseInput, type FieldErrors } from "@/lib/validation/core";
import {
  postTransactionSchema,
  studentIdSchema,
} from "@/lib/validation/schemas";
import {
  computeBalances,
  type FeeBalances,
  type LedgerRow,
  type LedgerType,
} from "@/lib/fees";

/** Returns the caller if they may POST fee transactions, else null. */
async function assertFeeWrites() {
  return currentUserWithCapability("feeWrites");
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
  rawStudentId: number,
): Promise<LedgerResult> {
  // Validate the id before it is used for anything, including the ownership
  // comparison — a non-integer would otherwise compare unequal and fall through
  // to the capability branch.
  const parsedId = parseInput(studentIdSchema, rawStudentId);
  if (!parsedId.ok) return { ok: false, error: "notFound" };
  const studentId = parsedId.data;

  // OWNERSHIP CHECK. `studentId` arrives from the caller and is therefore
  // untrusted. The comparison is against the SESSION user's id, so the only
  // ledger a student can ever pull is their own; staff with `fees`/`attendance`
  // may read any. Runs before a single row is read.
  const actor = await getCurrentUser();
  if (
    !actor ||
    !canReadStudentData({ id: actor.id, role: actor.role as Role }, studentId)
  ) {
    return { ok: false, error: "forbidden" };
  }

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
  | {
      ok: false;
      error: "forbidden" | "invalid" | "validation";
      fieldErrors?: FieldErrors;
    };

export async function postFeeTransactionAction(
  input: PostTransactionInput,
): Promise<PostTransactionResult> {
  // Authorization first (Admin / Principal / Office Admin hold `feeWrites`),
  // then validation, then any business DB call.
  const actor = await assertFeeWrites();
  if (!actor) return { ok: false, error: "forbidden" };

  // Types, lengths, enum membership, a real calendar date, a positive amount
  // with at most two decimals, and no unknown keys.
  const parsed = parseInput(postTransactionSchema, input);
  if (!parsed.ok) {
    return { ok: false, error: "validation", fieldErrors: parsed.fieldErrors };
  }
  const { studentId, type, particulars, amount, receiptNo, date } = parsed.data;

  // Confirm the target is really a student before writing.
  const [student] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.id, studentId))
    .limit(1);
  if (!student || student.role !== "student") {
    return { ok: false, error: "invalid" };
  }

  try {
    await db.insert(feeLedgers).values({
      studentId,
      particulars,
      type,
      amount,
      receiptNo: receiptNo ?? null,
      date,
      recordedBy: actor.id,
    });
  } catch (err) {
    logServerError("postFeeTransactionAction", err, { studentId, type });
    return { ok: false, error: "invalid" };
  }

  revalidatePath("/admin/fees");
  revalidatePath("/student/fees");
  revalidatePath("/admin");
  revalidatePath("/student");
  return { ok: true };
}
