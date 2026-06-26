// Server-only loader for circular feeds (shared by role dashboards).

import "server-only";
import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { circulars, users } from "@/db/schema";
import type { CircularItem } from "@/components/circulars/CircularsBoard";

/** Most recent circulars, newest first, shaped for the dashboard feed. */
export async function getRecentCirculars(limit = 5): Promise<CircularItem[]> {
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
    .orderBy(desc(circulars.createdAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, createdAt: r.createdAt.getTime() }));
}
