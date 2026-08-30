"use client";

// Admin support desk — a priority board grouped by status (Open → In progress →
// Resolved → Closed). Each ticket can be answered and its status flipped inline.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  updateTicketStatusAction,
  type TicketCategory,
  type TicketStatus,
} from "@/app/actions/support";
import { formatDisplayDate } from "@/lib/dates";

export type AdminTicket = {
  id: number;
  category: TicketCategory;
  subject: string | null;
  message: string;
  status: TicketStatus;
  response: string | null;
  createdAt: number;
  studentName: string | null;
  studentRoll: string | null;
};

// Triage order — most urgent first.
const STATUS_ORDER: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-lavender text-primary",
  in_progress: "bg-lavender text-warning",
  resolved: "bg-mint text-teal",
  closed: "bg-canvas text-muted",
};

export function AdminSupport({ tickets }: { tickets: AdminTicket[] }) {
  const t = useT();
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(
    null,
  );

  const notify = (kind: "success" | "error", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 5000);
  };

  const grouped = useMemo(() => {
    const map: Record<TicketStatus, AdminTicket[]> = {
      open: [],
      in_progress: [],
      resolved: [],
      closed: [],
    };
    for (const tk of tickets) map[tk.status].push(tk);
    return map;
  }, [tickets]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="support.admin.title" />
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Editable tKey="support.admin.subtitle" />
        </p>
      </div>

      {/* Status summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {STATUS_ORDER.map((s) => (
          <div
            key={s}
            className="rounded-lg border border-line bg-surface p-3 shadow-sm"
          >
            <p className="text-xs text-muted">{t(`support.status.${s}`)}</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {grouped[s].length}
            </p>
          </div>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
          {t("support.admin.empty")}
        </div>
      ) : (
        STATUS_ORDER.filter((s) => grouped[s].length > 0).map((s) => (
          <section key={s} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[s]}`}
              >
                {t(`support.status.${s}`)}
              </span>
              <span className="text-muted">({grouped[s].length})</span>
            </h2>
            {grouped[s].map((tk) => (
              <TicketCard key={tk.id} ticket={tk} onResult={notify} />
            ))}
          </section>
        ))
      )}

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 right-4 z-60 max-w-xs rounded-md border px-3 py-2 text-sm shadow-md ${
            toast.kind === "success"
              ? "border-teal/40 bg-mint text-ink"
              : "border-danger/40 bg-lavender text-ink"
          }`}
        >
          {toast.msg}
        </div>
      )}
    </div>
  );
}

function TicketCard({
  ticket,
  onResult,
}: {
  ticket: AdminTicket;
  onResult: (kind: "success" | "error", msg: string) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [status, setStatus] = useState<TicketStatus>(ticket.status);
  const [response, setResponse] = useState(ticket.response ?? "");

  const fmtDate = (ms: number) =>
    formatDisplayDate(ms, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const update = () => {
    startTransition(async () => {
      const result = await updateTicketStatusAction({
        id: ticket.id,
        status,
        response,
      });
      if (result.ok) {
        router.refresh();
        onResult("success", t("support.toast.updated"));
      } else {
        onResult("error", t("support.toast.updateFailed"));
      }
    });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-ink">
            {ticket.studentName ?? "—"}
            {ticket.studentRoll && (
              <span className="ml-2 text-xs font-normal text-muted">
                {ticket.studentRoll}
              </span>
            )}
          </p>
          <span className="mt-1 inline-block rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">
            {t(`support.category.${ticket.category}`)}
          </span>
        </div>
        <span className="text-xs text-muted tabular-nums">
          {t("support.admin.raisedOn", { date: fmtDate(ticket.createdAt) })}
        </span>
      </div>

      {ticket.subject && (
        <h3 className="mt-2 text-sm font-semibold text-ink">{ticket.subject}</h3>
      )}
      <p className="mt-1 whitespace-pre-line text-sm text-muted">
        {ticket.message}
      </p>

      <div className="mt-3 flex flex-col gap-2 border-t border-line pt-3">
        <label
          htmlFor={`resp-${ticket.id}`}
          className="text-xs font-medium text-ink"
        >
          {t("support.admin.responseLabel")}
        </label>
        <textarea
          id={`resp-${ticket.id}`}
          value={response}
          onChange={(e) => setResponse(e.target.value)}
          placeholder={t("support.admin.responsePlaceholder")}
          rows={2}
          className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
        />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <label htmlFor={`status-${ticket.id}`} className="sr-only">
            {t("support.admin.statusLabel")}
          </label>
          <select
            id={`status-${ticket.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as TicketStatus)}
            className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
          >
            {STATUS_ORDER.map((s) => (
              <option key={s} value={s}>
                {t(`support.status.${s}`)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={update}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
          >
            {pending ? t("support.admin.updating") : t("support.admin.update")}
          </button>
        </div>
      </div>
    </div>
  );
}
