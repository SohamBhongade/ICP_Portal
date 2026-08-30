"use client";

// Account-request review queue. Each pending signup is a card with its fields
// shown as live inputs, so the admin can fix typos in place, then Approve
// (→ active) or Reject (→ rejected). Approve sends whatever is currently in the
// card's fields. A tiny toast (shared across cards) reports the result.
//
// A request carries NO credential (password_hash is NULL until approval), so
// each card also takes the password to assign. Leave it blank for the default
// temporary 'Icp@<roll number | email local-part>'. The approval toast echoes
// whichever password was set — the only time it is shown — so the approver can
// pass it to the applicant.

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, UserCheck } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  approveRequestAction,
  rejectRequestAction,
  type ActionError,
} from "@/app/actions/onboarding";
import type { Role } from "@/lib/auth/permissions";
import { formatDisplayDate } from "@/lib/dates";

type Item = { value: string; label: string };

// Per-role badge label so the approver sees exactly which role was requested
// (e.g. "Principal" vs a generic "Staff request").
const ROLE_BADGE_KEY: Record<Role, string> = {
  admin: "onboarding.roleAdmin",
  principal: "onboarding.rolePrincipal",
  "office admin": "onboarding.roleOfficeAdmin",
  faculty: "onboarding.roleFaculty",
  staff: "onboarding.roleStaff",
  student: "onboarding.roleStudent",
};

export type PendingRequest = {
  id: number;
  role: Role;
  fullName: string;
  studentId: string | null;
  email: string | null;
  phone: string | null;
  course: string | null;
  className: string | null;
  practicalBatch: string | null;
  employeeId: string | null;
  department: string | null;
  designation: string | null;
  createdAt: number;
};

type ToastKind = "success" | "error";

export function RequestsContent({
  requests,
  courseOptions,
  classOptions,
  batchOptions,
}: {
  requests: PendingRequest[];
  courseOptions: Item[];
  classOptions: Item[];
  batchOptions: Item[];
}) {
  const t = useT();
  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<{ kind: ToastKind; msg: string } | null>(
    null,
  );

  // Approval toasts carry the assigned password, which the admin has to read and
  // copy, so they linger noticeably longer than a plain success/error notice.
  const notify = (kind: ToastKind, msg: string, ms = 5000) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), ms);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return requests;
    return requests.filter(
      (r) =>
        r.fullName.toLowerCase().includes(q) ||
        (r.studentId?.toLowerCase().includes(q) ?? false) ||
        (r.email?.toLowerCase().includes(q) ?? false),
    );
  }, [requests, search]);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="requests.title" />
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Editable tKey="requests.subtitle" />
        </p>
      </div>

      {requests.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line bg-surface p-10 text-center">
          <UserCheck className="size-8 text-primary" aria-hidden />
          <p className="text-sm text-muted">{t("requests.empty")}</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full bg-lavender px-3 py-1 text-xs font-medium text-primary">
              {t("requests.pendingCount", { count: requests.length })}
            </span>
            <div className="relative w-full max-w-xs">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t("requests.searchPlaceholder")}
                className="w-full rounded-md border border-line bg-surface py-2 pl-9 pr-3 text-sm text-ink placeholder:text-muted focus:border-teal"
              />
            </div>
          </div>

          <div className="flex flex-col gap-4">
            {filtered.map((r) => (
              <RequestCard
                key={r.id}
                request={r}
                courseOptions={courseOptions}
                classOptions={classOptions}
                batchOptions={batchOptions}
                onResult={notify}
              />
            ))}
          </div>
        </>
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

const inputClass =
  "w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal";

function RequestCard({
  request,
  courseOptions,
  classOptions,
  batchOptions,
  onResult,
}: {
  request: PendingRequest;
  courseOptions: Item[];
  classOptions: Item[];
  batchOptions: Item[];
  onResult: (kind: ToastKind, msg: string, ms?: number) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [action, setAction] = useState<"approve" | "reject" | null>(null);

  const [fullName, setFullName] = useState(request.fullName);
  const [studentId, setStudentId] = useState(request.studentId ?? "");
  const [email, setEmail] = useState(request.email ?? "");
  const [phone, setPhone] = useState(request.phone ?? "");
  const [course, setCourse] = useState(request.course ?? "");
  const [className, setClassName] = useState(request.className ?? "");
  const [practicalBatch, setPracticalBatch] = useState(
    request.practicalBatch ?? "",
  );
  const [employeeId, setEmployeeId] = useState(request.employeeId ?? "");
  const [department, setDepartment] = useState(request.department ?? "");
  const [designation, setDesignation] = useState(request.designation ?? "");
  // Blank => the server generates the temporary default.
  const [password, setPassword] = useState("");

  const isStaff = request.role !== "student";
  const canApprove =
    fullName.trim() !== "" &&
    (isStaff ? email.trim() !== "" : studentId.trim() !== "");

  // formatDisplayDate pins locale AND time zone, so this renders identically
  // during SSR and hydration. Raw toLocaleDateString(locale, ...) still varies
  // by the HOST's zone, which put server and client a day apart after 18:30 UTC.
  const fmtDate = (ms: number) =>
    formatDisplayDate(ms, { day: "numeric", month: "short", year: "numeric" });

  const errorMessage = (error: ActionError) =>
    error === "duplicate"
      ? t("requests.toast.duplicate")
      : error === "weakPassword"
        ? t("requests.toast.weakPassword")
        : t("requests.toast.failed");

  const approve = () => {
    setAction("approve");
    startTransition(async () => {
      const result = await approveRequestAction({
        id: request.id,
        role: request.role,
        fullName,
        studentId,
        email,
        phone,
        course,
        className,
        practicalBatch,
        employeeId,
        department,
        designation,
        password,
      });
      setAction(null);
      if (result.ok) {
        onResult(
          "success",
          t("requests.toast.approved", {
            name: fullName.trim(),
            password: result.password,
          }),
          30000,
        );
        router.refresh();
      } else {
        onResult("error", errorMessage(result.error));
      }
    });
  };

  const reject = () => {
    if (!window.confirm(t("requests.confirmReject"))) return;
    setAction("reject");
    startTransition(async () => {
      const result = await rejectRequestAction(request.id);
      setAction(null);
      if (result.ok) {
        onResult("success", t("requests.toast.rejected"));
        router.refresh();
      } else {
        onResult("error", errorMessage(result.error));
      }
    });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-4 shadow-sm">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              isStaff ? "bg-mint text-teal" : "bg-lavender text-primary"
            }`}
          >
            {t(ROLE_BADGE_KEY[request.role])}
          </span>
          <span className="rounded-full bg-canvas px-2 py-0.5 text-xs font-medium text-muted">
            {t("onboarding.statusPending")}
          </span>
        </div>
        <span className="text-xs text-muted tabular-nums">
          {t("requests.requestedOn", { date: fmtDate(request.createdAt) })}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <CardField label={t("requests.fullName")}>
          <input
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            className={inputClass}
          />
        </CardField>
        {!isStaff && (
          <CardField label={t("requests.rollNo")}>
            <input
              value={studentId}
              onChange={(e) => setStudentId(e.target.value)}
              className={inputClass}
            />
          </CardField>
        )}
        <CardField label={t("requests.email")}>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={inputClass}
          />
        </CardField>
        <CardField label={t("requests.phone")}>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className={inputClass}
          />
        </CardField>
        {!isStaff && (
          <>
            <CardField label={t("requests.course")}>
              <CardSelect
                value={course}
                onChange={setCourse}
                options={courseOptions}
                placeholder={t("requests.selectPlaceholder")}
              />
            </CardField>
            <CardField label={t("requests.class")}>
              <CardSelect
                value={className}
                onChange={setClassName}
                options={classOptions}
                placeholder={t("requests.selectPlaceholder")}
              />
            </CardField>
            <CardField label={t("requests.practicalBatch")}>
              <CardSelect
                value={practicalBatch}
                onChange={setPracticalBatch}
                options={batchOptions}
                placeholder={t("requests.selectPlaceholder")}
              />
            </CardField>
          </>
        )}
        {isStaff && (
          <>
            <CardField label={t("requests.employeeId")}>
              <input
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                className={inputClass}
              />
            </CardField>
            <CardField label={t("requests.department")}>
              <input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                className={inputClass}
              />
            </CardField>
            <CardField label={t("requests.designation")}>
              <input
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                className={inputClass}
              />
            </CardField>
          </>
        )}
      </div>

      {/* Credential assigned on approval. Blank = the temporary default. */}
      <div className="mt-3 rounded-md border border-line bg-canvas p-3">
        <CardField label={t("requests.assignPassword")}>
          <input
            type="text"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("requests.assignPasswordPlaceholder")}
            autoComplete="off"
            className={inputClass}
          />
        </CardField>
        <p className="mt-1 text-xs text-muted">
          {t("requests.assignPasswordHint")}
        </p>
      </div>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-line pt-3">
        <button
          type="button"
          onClick={reject}
          disabled={busy}
          className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-danger hover:bg-lavender disabled:opacity-50"
        >
          {busy && action === "reject"
            ? t("requests.rejecting")
            : t("requests.reject")}
        </button>
        <button
          type="button"
          onClick={approve}
          disabled={busy || !canApprove}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
        >
          {busy && action === "approve"
            ? t("requests.approving")
            : t("requests.approve")}
        </button>
      </div>
    </div>
  );
}

function CardField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}

function CardSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: Item[];
  placeholder: string;
}) {
  // Keep an unknown legacy value (not in the active option list) selectable so
  // approving never silently drops a course/class that was later deactivated.
  const known = options.some((o) => o.value === value);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={inputClass}
    >
      <option value="">{placeholder}</option>
      {!known && value && <option value={value}>{value}</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
