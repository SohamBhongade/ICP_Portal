// Student Circulars (Phase 11) — read-only notice board (view / download).

import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { circulars, users } from "@/db/schema";
import { Editable } from "@/components/edit-mode/Editable";
import {
  CircularsBoard,
  type CircularItem,
} from "@/components/circulars/CircularsBoard";

export default async function StudentCircularsPage() {
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

  const items: CircularItem[] = rows.map((r) => ({
    ...r,
    createdAt: r.createdAt.getTime(),
  }));

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">
          <Editable tKey="circulars.title" />
        </h1>
        <p className="mt-1 text-sm text-muted">
          <Editable tKey="circulars.subtitle" />
        </p>
      </div>
      <CircularsBoard circulars={items} />
    </div>
  );
}
