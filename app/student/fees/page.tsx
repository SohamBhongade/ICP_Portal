// Student Fee Balance (Phase 10).
//
// Server component: pulls this student's own ledger, computes balances on the
// server (payments − charges), and renders the read-only StatCard dashboard +
// transaction history. Students can never mutate the ledger.

import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { feeLedgers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computeBalances, type LedgerRow } from "@/lib/fees";
import { StudentFeesView } from "./StudentFeesView";

export default async function StudentFeesPage() {
  const user = await requireUser();

  const rows: LedgerRow[] = await db
    .select({
      id: feeLedgers.id,
      date: feeLedgers.date,
      particulars: feeLedgers.particulars,
      type: feeLedgers.type,
      amount: feeLedgers.amount,
      receiptNo: feeLedgers.receiptNo,
    })
    .from(feeLedgers)
    .where(eq(feeLedgers.studentId, user.id))
    .orderBy(asc(feeLedgers.date), asc(feeLedgers.id));

  return <StudentFeesView rows={rows} balances={computeBalances(rows)} />;
}
