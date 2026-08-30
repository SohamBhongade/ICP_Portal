"use client";

// High-speed attendance grid (three-way: Present / Absent / Late).
//
// Teacher picks Course / Class / Semester / Subject / Batch; the roster is
// fetched on demand (course + class are the minimum). Each student is a single
// 44px-min row (mobile-friendly touch target) with a P/A/L segmented toggle,
// defaulting to "present". The sticky top bar carries "Mark entire class …"
// macros that set every loaded row at once before submitting.

import { useEffect, useState, useTransition } from "react";
import { Check, Clock, Users, X } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  EditableDropdown,
  type DropdownOptionItem,
} from "@/components/edit-mode/EditableDropdown";
import {
  fetchStudentsAction,
  submitAttendanceAction,
  type AttendanceStatus,
  type RosterStudent,
} from "@/app/actions/attendance";
import { fieldErrorSuffix } from "@/lib/validation/client";
import { todayIso } from "@/lib/dates";


export function AttendanceRecorder({
  courseOptions,
  classOptions,
  semesterOptions,
  subjectOptions,
  batchOptions,
}: {
  courseOptions: DropdownOptionItem[];
  classOptions: DropdownOptionItem[];
  semesterOptions: DropdownOptionItem[];
  subjectOptions: DropdownOptionItem[];
  batchOptions: DropdownOptionItem[];
}) {
  const t = useT();

  const [course, setCourse] = useState("");
  const [className, setClassName] = useState("");
  const [semester, setSemester] = useState("");
  const [subject, setSubject] = useState("");
  const [batch, setBatch] = useState(""); // "" = Theory (whole class)
  const [date, setDate] = useState(todayIso);

  const [roster, setRoster] = useState<RosterStudent[]>([]);
  // One status per student id; missing entries fall back to "present".
  const [statuses, setStatuses] = useState<Record<number, AttendanceStatus>>({});
  const [loading, startLoading] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(null);

  // Dynamically (re)fetch the roster whenever the class scope changes. All state
  // updates happen inside the async transition (never synchronously in the
  // effect body) so we don't trigger cascading renders.
  useEffect(() => {
    let cancelled = false;
    startLoading(async () => {
      if (!course || !className) {
        if (!cancelled) {
          setRoster([]);
          setStatuses({});
        }
        return;
      }
      const students = await fetchStudentsAction({
        course,
        className,
        practicalBatch: batch || undefined,
      });
      if (cancelled) return;
      setRoster(students);
      // Default everyone to present.
      setStatuses(Object.fromEntries(students.map((s) => [s.id, "present"])));
    });
    return () => {
      cancelled = true;
    };
  }, [course, className, batch]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  let presentCount = 0;
  let absentCount = 0;
  let lateCount = 0;
  for (const s of roster) {
    const st = statuses[s.id] ?? "present";
    if (st === "absent") absentCount += 1;
    else if (st === "late") lateCount += 1;
    else presentCount += 1;
  }

  const setStatus = (id: number, status: AttendanceStatus) =>
    setStatuses((prev) => ({ ...prev, [id]: status }));

  // Master macro: stamp every loaded row with one status.
  const markAll = (status: AttendanceStatus) =>
    setStatuses(Object.fromEntries(roster.map((s) => [s.id, status])));

  const canSubmit = roster.length > 0 && !!subject && !submitting;

  const submit = () => {
    if (!subject) {
      setToast({ kind: "error", msg: t("attendance.subjectRequired") });
      return;
    }
    if (roster.length === 0) {
      setToast({ kind: "error", msg: t("attendance.toast.empty") });
      return;
    }
    startSubmit(async () => {
      const result = await submitAttendanceAction({
        date,
        className,
        subject,
        practicalBatch: batch || undefined,
        records: roster.map((s) => ({
          studentId: s.id,
          status: statuses[s.id] ?? "present",
        })),
      });
      if (result.ok) {
        setToast({
          kind: "success",
          msg: t("attendance.toast.saved", { count: result.count }),
        });
      } else {
        setToast({
          kind: "error",
          msg:
            result.error === "empty"
              ? t("attendance.toast.empty")
              : result.error === "pastDateForbidden"
                ? t("attendance.toast.pastDateForbidden")
                : result.error === "futureDate"
                  ? t("attendance.toast.futureDate")
                  : result.error === "validation"
                    ? t("attendance.toast.validation") +
                      fieldErrorSuffix(result.fieldErrors)
                    : t("attendance.toast.failed"),
        });
      }
    });
  };

  const statusLabels: Record<AttendanceStatus, string> = {
    present: t("attendance.present"),
    absent: t("attendance.absent"),
    late: t("attendance.late"),
  };

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="attendance.recordTitle" />
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Editable tKey="attendance.recordSubtitle" />
        </p>
      </div>

      {/* Selection controls */}
      <div className="rounded-lg border border-line bg-surface p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <SelectField label={t("attendance.course")}>
            <EditableDropdown
              category="course"
              options={courseOptions}
              value={course}
              onChange={setCourse}
              placeholder={t("attendance.selectPlaceholder")}
            />
          </SelectField>
          <SelectField label={t("attendance.class")}>
            <EditableDropdown
              category="class"
              options={classOptions}
              value={className}
              onChange={setClassName}
              placeholder={t("attendance.selectPlaceholder")}
            />
          </SelectField>
          <SelectField label={t("attendance.semester")}>
            <EditableDropdown
              category="semester"
              options={semesterOptions}
              value={semester}
              onChange={setSemester}
              placeholder={t("attendance.selectPlaceholder")}
            />
          </SelectField>
          <SelectField label={t("attendance.subject")}>
            <EditableDropdown
              category="subject"
              options={subjectOptions}
              value={subject}
              onChange={setSubject}
              placeholder={t("attendance.selectPlaceholder")}
            />
          </SelectField>
          <SelectField label={t("attendance.batch")}>
            <EditableDropdown
              category="practical_batch"
              options={batchOptions}
              value={batch}
              onChange={setBatch}
              placeholder={t("attendance.theory")}
            />
          </SelectField>
          <SelectField label={t("attendance.date")}>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
            />
          </SelectField>
        </div>
      </div>

      {/* Roster grid */}
      <div className="rounded-lg border border-line bg-surface shadow-sm">
        {/* Sticky utilities top-bar: summary + master macros */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Users className="size-4 text-muted" />
            {roster.length > 0
              ? t("attendance.summary", {
                  present: presentCount,
                  absent: absentCount,
                  late: lateCount,
                })
              : t("attendance.rosterCount", { count: roster.length })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => markAll("present")}
              disabled={roster.length === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-teal/40 hover:bg-mint disabled:opacity-50"
            >
              <Check className="size-4 text-teal" /> {t("attendance.markAllPresent")}
            </button>
            <button
              type="button"
              onClick={() => markAll("absent")}
              disabled={roster.length === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-danger/40 hover:bg-danger/10 disabled:opacity-50"
            >
              <X className="size-4 text-danger" /> {t("attendance.markAllAbsent")}
            </button>
            <button
              type="button"
              onClick={() => markAll("late")}
              disabled={roster.length === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:border-warning/40 hover:bg-warning/10 disabled:opacity-50"
            >
              <Clock className="size-4 text-warning" /> {t("attendance.markAllLate")}
            </button>
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="py-10 text-center text-sm text-muted">
              {t("attendance.loading")}
            </p>
          ) : !course || !className ? (
            <p className="py-10 text-center text-sm text-muted">
              {t("attendance.loadPrompt")}
            </p>
          ) : roster.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted">
              {t("attendance.noStudents")}
            </p>
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {roster.map((s) => {
                const st = statuses[s.id] ?? "present";
                const accent =
                  st === "absent"
                    ? "border-l-4 border-l-danger"
                    : st === "late"
                      ? "border-l-4 border-l-warning"
                      : "border-l-4 border-l-teal";
                return (
                  <li key={s.id}>
                    <div
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 ${accent}`}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {s.fullName}
                        </span>
                        {s.studentId && (
                          <span className="block truncate text-xs text-muted">
                            {s.studentId}
                          </span>
                        )}
                      </span>
                      <StatusToggle
                        value={st}
                        onChange={(v) => setStatus(s.id, v)}
                        labels={statusLabels}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {roster.length > 0 && (
          <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-3">
            {!subject && (
              <p className="text-sm text-muted">
                {subjectOptions.length === 0
                  ? t("attendance.subjectOptionsEmpty")
                  : t("attendance.subjectRequired")}
              </p>
            )}
            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="inline-flex min-h-11 items-center rounded-md bg-primary px-5 text-sm font-medium text-primary-foreground hover:bg-primary-hover disabled:opacity-50"
            >
              {submitting
                ? t("attendance.submitting")
                : t("attendance.submit")}
            </button>
          </div>
        )}
      </div>

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

// P / A / L segmented control. Letters stay universal; the full localized word
// is exposed via aria-label/title. Active state carries the semantic color:
// teal=present, crimson=absent, amber=late.
function StatusToggle({
  value,
  onChange,
  labels,
}: {
  value: AttendanceStatus;
  onChange: (v: AttendanceStatus) => void;
  labels: Record<AttendanceStatus, string>;
}) {
  const opts: { v: AttendanceStatus; short: string; active: string }[] = [
    { v: "present", short: "P", active: "bg-teal text-teal-foreground" },
    { v: "absent", short: "A", active: "bg-danger text-white" },
    { v: "late", short: "L", active: "bg-warning text-white" },
  ];
  return (
    <div
      role="group"
      className="inline-flex shrink-0 overflow-hidden rounded-md border border-line"
    >
      {opts.map((o, i) => (
        <button
          key={o.v}
          type="button"
          onClick={() => onChange(o.v)}
          aria-pressed={value === o.v}
          aria-label={labels[o.v]}
          title={labels[o.v]}
          className={`flex min-h-11 w-11 items-center justify-center text-sm font-semibold transition-colors ${
            i > 0 ? "border-l border-line" : ""
          } ${value === o.v ? o.active : "bg-surface text-muted hover:bg-canvas"}`}
        >
          {o.short}
        </button>
      ))}
    </div>
  );
}

function SelectField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium text-ink">{label}</label>
      {children}
    </div>
  );
}
