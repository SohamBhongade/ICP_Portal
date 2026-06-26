// Teacher Circulars (Phase 11) — teachers can publish + manage circulars too.

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { circulars, users } from "@/db/schema";
import { CircularComposer } from "@/components/circulars/CircularComposer";
import {
  CircularsBoard,
  type CircularItem,
} from "@/components/circulars/CircularsBoard";

async function loadCirculars(): Promise<CircularItem[]> {
  const rows = await db
    .select({
      id: circulars.id,
      title: circulars.title,
      description: circulars.description,
      fileUrl: circulars.fileUrl,
      fileType: circulars.fileType,
      createdAt: circulars.createdAt,
      uploaderName: users.fullName,
    })
    .from(circulars)
    .leftJoin(users, eq(circulars.uploadedBy, users.id))
    .orderBy(desc(circulars.createdAt));

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
}

export default async function TeacherCircularsPage() {
  const items = await loadCirculars();
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <CircularComposer />
      <CircularsBoard circulars={items} canManage />
    </div>
  );
}
