"use client";

// Student support — a ticket-raising form plus a tracker for existing tickets.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, Send } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  createTicketAction,
  type TicketCategory,
  type TicketStatus,
} from "@/app/actions/support";
import { formatDisplayDate } from "@/lib/dates";

export type StudentTicket = {
  id: number;
  category: TicketCategory;
  subject: string | null;
  message: string;
  status: TicketStatus;
  response: string | null;
  createdAt: number;
};

const CATEGORIES: TicketCategory[] = [
  "fee",
  "attendance",
  "technical",
  "academic",
  "administrative",
];

const STATUS_STYLE: Record<TicketStatus, string> = {
  open: "bg-lavender text-primary",
  in_progress: "bg-lavender text-warning",
  resolved: "bg-mint text-teal",
  closed: "bg-canvas text-muted",
};

export function StudentSupport({ tickets }: { tickets: StudentTicket[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const [category, setCategory] = useState<TicketCategory>("fee");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(
    null,
  );

  const notify = (kind: "success" | "error", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 5000);
  };

  const fmtDate = (ms: number) =>
    formatDisplayDate(ms, {
      day: "numeric",
      month: "short",
      year: "numeric",
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!message.trim()) return notify("error", t("support.toast.invalid"));
    startTransition(async () => {
      const result = await createTicketAction({ category, subject, message });
      if (result.ok) {
        setSubject("");
        setMessage("");
        setCategory("fee");
        router.refresh();
        notify("success", t("support.toast.created"));
      } else {
        notify("error", t("support.toast.createFailed"));
      }
    });
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="support.student.title" />
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Editable tKey="support.student.subtitle" />
        </p>
      </div>

      {/* Raise a ticket */}
      <div className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <div className="mb-4 flex items-center gap-2">
          <LifeBuoy className="size-5 text-primary" />
          <h2 className="text-base font-semibold text-ink">
            {t("support.student.formTitle")}
          </h2>
        </div>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="tk-cat"
                className="mb-1 block text-sm font-medium text-ink"
              >
                {t("support.student.categoryLabel")}
              </label>
              <select
                id="tk-cat"
                value={category}
                onChange={(e) => setCategory(e.target.value as TicketCategory)}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
              >
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {t(`support.category.${c}`)}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label
                htmlFor="tk-subject"
                className="mb-1 block text-sm font-medium text-ink"
              >
                {t("support.student.subjectLabel")}
              </label>
              <input
                id="tk-subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("support.student.subjectPlaceholder")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
              />
            </div>
          </div>
          <div>
            <label
              htmlFor="tk-msg"
              className="mb-1 block text-sm font-medium text-ink"
            >
              {t("support.student.messageLabel")}
            </label>
            <textarea
              id="tk-msg"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder={t("support.student.messagePlaceholder")}
              rows={4}
              required
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
            />
          </div>
          <div className="flex items-center justify-end gap-3">
            {toast && (
              <span
                role="status"
                className={`text-sm ${
                  toast.kind === "success" ? "text-teal" : "text-danger"
                }`}
              >
                {toast.msg}
              </span>
            )}
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              <Send className="size-4" />
              {pending
                ? t("support.student.submitting")
                : t("support.student.submit")}
            </button>
          </div>
        </form>
      </div>

      {/* Tracker */}
      <section>
        <h2 className="mb-3 text-base font-semibold text-ink">
          {t("support.student.trackerTitle")}
        </h2>
        {tickets.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-surface p-10 text-center text-sm text-muted">
            {t("support.student.empty")}
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {tickets.map((tk) => (
              <li
                key={tk.id}
                className="rounded-lg border border-line bg-surface p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">
                      {t(`support.category.${tk.category}`)}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[tk.status]}`}
                    >
                      {t(`support.status.${tk.status}`)}
                    </span>
                  </div>
                  <span className="text-xs text-muted tabular-nums">
                    {t("support.student.raisedOn", { date: fmtDate(tk.createdAt) })}
                  </span>
                </div>
                {tk.subject && (
                  <h3 className="mt-2 text-sm font-semibold text-ink">
                    {tk.subject}
                  </h3>
                )}
                <p className="mt-1 whitespace-pre-line text-sm text-muted">
                  {tk.message}
                </p>
                <div className="mt-3 rounded-md border border-line bg-canvas px-3 py-2">
                  <p className="text-xs font-medium text-ink">
                    {t("support.student.responseLabel")}
                  </p>
                  <p className="mt-0.5 text-sm text-muted">
                    {tk.response ?? t("support.student.noResponse")}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
