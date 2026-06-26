"use client";

// High-speed attendance grid.
//
// Teacher picks Course / Class / Semester / Subject / Batch; the roster is
// fetched on demand (course + class are the minimum). Each student is a single
// 44px-min toggle row (mobile-friendly touch target) defaulting to "present",
// with top-bar "Select all present" / "Invert selection" utilities for speed.

import { useEffect, useState, useTransition } from "react";
import { Check, RotateCcw, Users, X } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  EditableDropdown,
  type DropdownOptionItem,
} from "@/components/edit-mode/EditableDropdown";
import {
  fetchStudentsAction,
  submitAttendanceAction,
  type RosterStudent,
} from "@/app/actions/attendance";

function todayISO() {
  // Local-date ISO (YYYY-MM-DD), not UTC, so "today" matches the teacher's day.
  const d = new Date();
  const off = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - off).toISOString().slice(0, 10);
}

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
  const [date, setDate] = useState(todayISO);

  const [roster, setRoster] = useState<RosterStudent[]>([]);
  const [present, setPresent] = useState<Set<number>>(new Set());
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
          setPresent(new Set());
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
      setPresent(new Set(students.map((s) => s.id))); // default everyone present
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

  const presentCount = present.size;
  const absentCount = roster.length - presentCount;

  const toggle = (id: number) =>
    setPresent((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const selectAllPresent = () => setPresent(new Set(roster.map((s) => s.id)));
  const invert = () =>
    setPresent((prev) => {
      const next = new Set<number>();
      for (const s of roster) if (!prev.has(s.id)) next.add(s.id);
      return next;
    });

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
          status: present.has(s.id) ? "present" : "absent",
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
              : t("attendance.toast.failed"),
        });
      }
    });
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
        {/* Sticky utilities top-bar */}
        <div className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-3 rounded-t-lg border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Users className="size-4 text-muted" />
            {roster.length > 0
              ? t("attendance.summary", {
                  present: presentCount,
                  absent: absentCount,
                })
              : t("attendance.rosterCount", { count: roster.length })}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={selectAllPresent}
              disabled={roster.length === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-mint disabled:opacity-50"
            >
              <Check className="size-4" /> {t("attendance.selectAllPresent")}
            </button>
            <button
              type="button"
              onClick={invert}
              disabled={roster.length === 0}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-md border border-line bg-surface px-3 text-sm font-medium text-ink hover:bg-lavender disabled:opacity-50"
            >
              <RotateCcw className="size-4" /> {t("attendance.invertSelection")}
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
                const isPresent = present.has(s.id);
                return (
                  <li key={s.id}>
                    <button
                      type="button"
                      onClick={() => toggle(s.id)}
                      aria-pressed={isPresent}
                      className={`flex min-h-11 w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                        isPresent
                          ? "border-teal/40 bg-mint"
                          : "border-line bg-canvas"
                      }`}
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
                      <span
                        className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${
                          isPresent
                            ? "bg-teal text-teal-foreground"
                            : "bg-lavender text-primary"
                        }`}
                      >
                        {isPresent ? (
                          <>
                            <Check className="size-3.5" />
                            {t("attendance.present")}
                          </>
                        ) : (
                          <>
                            <X className="size-3.5" />
                            {t("attendance.absent")}
                          </>
                        )}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {roster.length > 0 && (
          <div className="flex items-center justify-end gap-3 border-t border-line px-4 py-3">
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
          className={`fixed bottom-4 right-4 z-50 max-w-xs rounded-md border px-3 py-2 text-sm shadow-md ${
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
