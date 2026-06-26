"use client";

// Admin fee ledger — student lookup + per-student ledger + post-transaction modal.
//
// The roster is searchable on the left; picking a student fetches their ledger
// on demand (server action) and renders computed balance StatCards plus a
// chronological table with a running outstanding balance. Posting a charge or
// payment reloads the ledger in place.

import { useMemo, useState, useTransition } from "react";
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Plus,
  Receipt,
  Search,
  Wallet,
  X,
} from "lucide-react";
import { StatCard } from "@/components/ui/StatCard";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  fetchStudentLedgerAction,
  postFeeTransactionAction,
  type LedgerResult,
  type LedgerStudent,
} from "@/app/actions/fees";
import { formatCurrency, type LedgerRow, type LedgerType } from "@/lib/fees";

type Student = {
  id: number;
  fullName: string;
  studentId: string | null;
  course: string | null;
  className: string | null;
};

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

export function FeesAdmin({ students }: { students: Student[] }) {
  const t = useT();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [ledger, setLedger] = useState<Extract<LedgerResult, { ok: true }> | null>(
    null,
  );
  const [loading, startLoading] = useTransition();
  const [modalOpen, setModalOpen] = useState(false);
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(
    null,
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.fullName.toLowerCase().includes(q) ||
        (s.studentId?.toLowerCase().includes(q) ?? false),
    );
  }, [students, search]);

  const loadLedger = (id: number) =>
    startLoading(async () => {
      const result = await fetchStudentLedgerAction(id);
      if (result.ok) setLedger(result);
      else {
        setLedger(null);
        setToast({ kind: "error", msg: t("fees.toast.failed") });
      }
    });

  const selectStudent = (id: number) => {
    setSelectedId(id);
    setLedger(null);
    loadLedger(id);
  };

  const selected = students.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="fees.title" />
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Editable tKey="fees.subtitle" />
        </p>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row">
        {/* Student lookup */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
            <div className="relative mb-3">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("fees.searchPlaceholder")}
                aria-label={t("fees.searchStudents")}
                className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink focus:border-teal"
              />
            </div>
            <p className="mb-2 text-xs text-muted">
              {t("fees.studentsCount", { count: filtered.length })}
            </p>
            <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
              {filtered.length === 0 ? (
                <li className="py-6 text-center text-sm text-muted">
                  {t("fees.noStudents")}
                </li>
              ) : (
                filtered.map((s) => (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => selectStudent(s.id)}
                      className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                        s.id === selectedId
                          ? "border-teal/40 bg-mint"
                          : "border-transparent hover:bg-canvas"
                      }`}
                    >
                      <span className="block truncate text-sm font-medium text-ink">
                        {s.fullName}
                      </span>
                      <span className="block truncate text-xs text-muted">
                        {[s.studentId, s.className].filter(Boolean).join(" · ") ||
                          "—"}
                      </span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        </aside>

        {/* Ledger */}
        <section className="min-w-0 flex-1">
          {!selected ? (
            <div className="flex min-h-64 items-center justify-center rounded-lg border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
              {t("fees.selectPrompt")}
            </div>
          ) : (
            <div className="flex flex-col gap-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">
                    {selected.fullName}
                  </h2>
                  <p className="text-sm text-muted">
                    {[selected.studentId, selected.course, selected.className]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setModalOpen(true)}
                  className="inline-flex items-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  <Plus className="size-4" /> {t("fees.addTransaction")}
                </button>
              </div>

              {ledger && (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
                  <StatCard
                    label={t("fees.charged")}
                    value={formatCurrency(ledger.balances.charged)}
                    icon={ArrowUpCircle}
                  />
                  <StatCard
                    label={t("fees.paid")}
                    value={formatCurrency(ledger.balances.paid)}
                    icon={ArrowDownCircle}
                    tone="mint"
                  />
                  <StatCard
                    label={t("fees.outstanding")}
                    value={formatCurrency(ledger.balances.balance)}
                    icon={Wallet}
                  />
                </div>
              )}

              <div className="rounded-lg border border-line bg-surface shadow-sm">
                <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                  {t("fees.ledgerTitle")}
                </div>
                {loading ? (
                  <p className="py-10 text-center text-sm text-muted">
                    {t("fees.loading")}
                  </p>
                ) : !ledger || ledger.rows.length === 0 ? (
                  <p className="py-10 text-center text-sm text-muted">
                    {t("fees.emptyLedger")}
                  </p>
                ) : (
                  <LedgerTable rows={ledger.rows} />
                )}
              </div>
            </div>
          )}
        </section>
      </div>

      {modalOpen && selected && (
        <PostTransactionModal
          student={selected}
          onClose={() => setModalOpen(false)}
          onPosted={() => {
            setModalOpen(false);
            setToast({ kind: "success", msg: t("fees.toast.posted") });
            loadLedger(selected.id);
          }}
          onError={(msg) => setToast({ kind: "error", msg })}
        />
      )}

      {toast && <Toast toast={toast} onDismiss={() => setToast(null)} />}
    </div>
  );
}

function LedgerTable({ rows }: { rows: LedgerRow[] }) {
  const t = useT();
  // Running outstanding balance, computed in chronological order as a cumulative
  // sum (no render-scope mutation, per react-hooks/immutability).
  const signed = (r: LedgerRow) => (r.type === "charge" ? r.amount : -r.amount);
  const withBalance = rows.map((r, i) => ({
    row: r,
    balance: rows.slice(0, i + 1).reduce((sum, x) => sum + signed(x), 0),
  }));

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-left text-sm">
        <thead>
          <tr className="border-b border-line bg-canvas text-xs uppercase tracking-wide text-muted">
            <th className="px-4 py-3 font-medium">{t("fees.colDate")}</th>
            <th className="px-4 py-3 font-medium">{t("fees.colParticulars")}</th>
            <th className="px-4 py-3 font-medium">{t("fees.colReceipt")}</th>
            <th className="px-4 py-3 text-right font-medium">
              {t("fees.colDebit")}
            </th>
            <th className="px-4 py-3 text-right font-medium">
              {t("fees.colCredit")}
            </th>
            <th className="px-4 py-3 text-right font-medium">
              {t("fees.colBalance")}
            </th>
          </tr>
        </thead>
        <tbody>
          {withBalance.map(({ row, balance }) => (
            <tr key={row.id} className="border-b border-line last:border-0">
              <td className="whitespace-nowrap px-4 py-3 text-muted tabular-nums">
                {row.date}
              </td>
              <td className="px-4 py-3 text-ink">{row.particulars}</td>
              <td className="px-4 py-3 text-muted">{row.receiptNo ?? "—"}</td>
              <td className="px-4 py-3 text-right tabular-nums text-danger">
                {row.type === "charge" ? formatCurrency(row.amount) : "—"}
              </td>
              <td className="px-4 py-3 text-right tabular-nums text-teal">
                {row.type === "payment" ? formatCurrency(row.amount) : "—"}
              </td>
              <td className="px-4 py-3 text-right font-medium tabular-nums text-ink">
                {formatCurrency(balance)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const CHARGE_OPTS = [
  { value: "Tuition fee", key: "fees.cat.tuition" },
  { value: "Library fee", key: "fees.cat.library" },
  { value: "Other charge", key: "fees.cat.otherCharge" },
];
const PAYMENT_OPTS = [
  { value: "Cash payment", key: "fees.cat.cash" },
  { value: "Online payment", key: "fees.cat.online" },
  { value: "Other payment", key: "fees.cat.otherPayment" },
];

function PostTransactionModal({
  student,
  onClose,
  onPosted,
  onError,
}: {
  student: LedgerStudent;
  onClose: () => void;
  onPosted: () => void;
  onError: (msg: string) => void;
}) {
  const t = useT();
  const [pending, startTransition] = useTransition();

  const [type, setType] = useState<LedgerType>("charge");
  const [category, setCategory] = useState(CHARGE_OPTS[0].value);
  const [amount, setAmount] = useState("");
  const [reference, setReference] = useState("");
  const [remarks, setRemarks] = useState("");
  const [date, setDate] = useState(todayISO);

  const opts = type === "charge" ? CHARGE_OPTS : PAYMENT_OPTS;

  const changeType = (next: LedgerType) => {
    setType(next);
    setCategory((next === "charge" ? CHARGE_OPTS : PAYMENT_OPTS)[0].value);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      onError(t("fees.toast.invalid"));
      return;
    }
    const note = remarks.trim();
    const particulars = note ? `${category} — ${note}` : category;

    startTransition(async () => {
      const result = await postFeeTransactionAction({
        studentId: student.id,
        type,
        particulars,
        amount: value,
        receiptNo: reference,
        date,
      });
      if (result.ok) onPosted();
      else onError(t("fees.toast.failed"));
    });
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center p-4">
      <button
        type="button"
        aria-label={t("fees.modal.cancel")}
        onClick={onClose}
        className="absolute inset-0 bg-ink/30"
      />
      <div
        role="dialog"
        aria-modal="true"
        className="relative w-full max-w-md rounded-lg bg-surface shadow-xl"
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold text-ink">
            {t("fees.modal.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("fees.modal.cancel")}
            className="rounded p-1 text-muted hover:bg-lavender hover:text-ink"
          >
            <X className="size-5" />
          </button>
        </div>

        <form onSubmit={submit} className="flex flex-col gap-4 p-5">
          <p className="text-sm text-muted">
            {t("fees.modal.forStudent", { name: student.fullName })}
          </p>

          {/* Type toggle */}
          <div>
            <span className="mb-1 block text-sm font-medium text-ink">
              {t("fees.modal.typeLabel")}
            </span>
            <div className="grid grid-cols-2 gap-2">
              {(["charge", "payment"] as const).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => changeType(opt)}
                  className={`inline-flex items-center justify-center gap-1.5 rounded-md border px-3 py-2 text-sm font-medium transition-colors ${
                    type === opt
                      ? opt === "charge"
                        ? "border-danger/40 bg-lavender text-danger"
                        : "border-teal/40 bg-mint text-teal"
                      : "border-line bg-surface text-muted hover:bg-canvas"
                  }`}
                >
                  {opt === "charge" ? (
                    <ArrowUpCircle className="size-4" />
                  ) : (
                    <ArrowDownCircle className="size-4" />
                  )}
                  {t(opt === "charge" ? "fees.typeCharge" : "fees.typePayment")}
                </button>
              ))}
            </div>
          </div>

          <Field label={t("fees.modal.categoryLabel")} htmlFor="ftx-cat">
            <select
              id="ftx-cat"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className={inputClass}
            >
              {opts.map((o) => (
                <option key={o.value} value={o.value}>
                  {t(o.key)}
                </option>
              ))}
            </select>
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label={t("fees.modal.amountLabel")} htmlFor="ftx-amount">
              <input
                id="ftx-amount"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={t("fees.modal.amountPlaceholder")}
                required
                className={`${inputClass} tabular-nums`}
              />
            </Field>
            <Field label={t("fees.modal.dateLabel")} htmlFor="ftx-date">
              <input
                id="ftx-date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={inputClass}
              />
            </Field>
          </div>

          <Field label={t("fees.modal.referenceLabel")} htmlFor="ftx-ref">
            <input
              id="ftx-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder={t("fees.modal.referencePlaceholder")}
              className={inputClass}
            />
          </Field>

          <Field label={t("fees.modal.remarksLabel")} htmlFor="ftx-remarks">
            <input
              id="ftx-remarks"
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              placeholder={t("fees.modal.remarksPlaceholder")}
              className={inputClass}
            />
          </Field>

          <div className="mt-2 flex items-center justify-end gap-2 border-t border-line pt-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-lavender"
            >
              {t("fees.modal.cancel")}
            </button>
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              <Receipt className="size-4" />
              {pending ? t("fees.modal.submitting") : t("fees.modal.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal";

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label
        htmlFor={htmlFor}
        className="mb-1 block text-sm font-medium text-ink"
      >
        {label}
      </label>
      {children}
    </div>
  );
}

function Toast({
  toast,
  onDismiss,
}: {
  toast: { kind: "success" | "error"; msg: string };
  onDismiss: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDismiss}
      role="status"
      className={`fixed bottom-4 right-4 z-50 max-w-xs rounded-md border px-3 py-2 text-left text-sm shadow-md ${
        toast.kind === "success"
          ? "border-teal/40 bg-mint text-ink"
          : "border-danger/40 bg-lavender text-ink"
      }`}
    >
      {toast.msg}
    </button>
  );
}
