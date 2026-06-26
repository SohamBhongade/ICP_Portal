// Teacher attendance recording (Phase 9).
//
// Server component: loads the dropdown option sets (Edit Mode backbone) for the
// class-selection controls, then hands off to the client recorder which fetches
// the matching roster on demand and submits the present/absent matrix.

import { getDropdownOptions } from "@/lib/edit-mode/settings";
import { AttendanceRecorder } from "./AttendanceRecorder";

export default async function TeacherAttendancePage() {
  const [courseOpts, classOpts, semesterOpts, subjectOpts, batchOpts] =
    await Promise.all([
      getDropdownOptions("course"),
      getDropdownOptions("class"),
      getDropdownOptions("semester"),
      getDropdownOptions("subject"),
      getDropdownOptions("practical_batch"),
    ]);

  const toItems = (opts: { id: number; value: string; label: string }[]) =>
    opts.map((o) => ({ id: o.id, value: o.value, label: o.label }));

  return (
    <AttendanceRecorder
      courseOptions={toItems(courseOpts)}
      classOptions={toItems(classOpts)}
      semesterOptions={toItems(semesterOpts)}
      subjectOptions={toItems(subjectOpts)}
      batchOptions={toItems(batchOpts)}
    />
  );
}
