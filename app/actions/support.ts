"use server";

// Phase 11 — Communications & Support server actions.
//
// Circulars (admin + teacher publish; everyone reads):
//   - requestCircularUploadAction: mint a signed Cloudinary upload ticket
//   - createCircularAction:        persist URL + metadata after upload
//   - deleteCircularAction:        remove a circular (+ best-effort media delete)
//
// Support tickets:
//   - createTicketAction:       student opens a ticket
//   - updateTicketStatusAction: admin responds + flips the status flag
//
// Every action re-verifies the caller's role server-side (never trust the
// client) and returns a typed result rather than throwing.

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { circulars, supportTickets, type User } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";
import type { Role } from "@/lib/auth/session";
import {
  CIRCULARS_FOLDER,
  cloudinary,
  isCloudinaryConfigured,
  signUploadParams,
} from "@/lib/cloudinary";

/** Return the current user only if their role is allowed, else null. */
async function getRoleUser(...roles: Role[]): Promise<User | null> {
  const user = await getCurrentUser();
  if (!user || !roles.includes(user.role as Role)) return null;
  return user;
}

export type FileType = "pdf" | "image";
export type TicketCategory =
  | "fee"
  | "attendance"
  | "technical"
  | "academic"
  | "administrative";
export type TicketStatus = "open" | "in_progress" | "resolved" | "closed";

const TICKET_CATEGORIES: TicketCategory[] = [
  "fee",
  "attendance",
  "technical",
  "academic",
  "administrative",
];
const TICKET_STATUSES: TicketStatus[] = [
  "open",
  "in_progress",
  "resolved",
  "closed",
];

// ---------- Circulars ----------

export type UploadTicket =
  | {
      ok: true;
      cloudName: string;
      apiKey: string;
      timestamp: number;
      signature: string;
      folder: string;
    }
  | { ok: false; error: "forbidden" | "unconfigured" };

/** Mint a signed, time-boxed Cloudinary upload ticket for staff. */
export async function requestCircularUploadAction(): Promise<UploadTicket> {
  if (!(await getRoleUser("admin", "teacher"))) {
    return { ok: false, error: "forbidden" };
  }
  if (!isCloudinaryConfigured()) {
    return { ok: false, error: "unconfigured" };
  }

  const timestamp = Math.round(Date.now() / 1000);
  const signature = signUploadParams({
    folder: CIRCULARS_FOLDER,
    timestamp,
  });

  return {
    ok: true,
    cloudName: process.env.CLOUDINARY_CLOUD_NAME as string,
    apiKey: process.env.CLOUDINARY_API_KEY as string,
    timestamp,
    signature,
    folder: CIRCULARS_FOLDER,
  };
}

export type CreateCircularInput = {
  title: string;
  description?: string;
  fileUrl: string;
  fileType: FileType;
  cloudinaryPublicId?: string;
};

export type CircularResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "invalid" };

export async function createCircularAction(
  input: CreateCircularInput,
): Promise<CircularResult> {
  const staff = await getRoleUser("admin", "teacher");
  if (!staff) return { ok: false, error: "forbidden" };

  const title = input.title?.trim();
  const fileUrl = input.fileUrl?.trim();
  const fileType = input.fileType;
  if (!title || !fileUrl || (fileType !== "pdf" && fileType !== "image")) {
    return { ok: false, error: "invalid" };
  }

  await db.insert(circulars).values({
    title,
    description: input.description?.trim() || null,
    fileUrl,
    fileType,
    cloudinaryPublicId: input.cloudinaryPublicId?.trim() || null,
    uploadedBy: staff.id,
  });

  for (const path of [
    "/admin/circulars",
    "/teacher/circulars",
    "/student/circulars",
    "/admin",
    "/teacher",
    "/student",
  ]) {
    revalidatePath(path);
  }
  return { ok: true };
}

export async function deleteCircularAction(
  id: number,
): Promise<CircularResult> {
  const staff = await getRoleUser("admin", "teacher");
  if (!staff) return { ok: false, error: "forbidden" };

  const [row] = await db
    .select({ publicId: circulars.cloudinaryPublicId })
    .from(circulars)
    .where(eq(circulars.id, id))
    .limit(1);
  if (!row) return { ok: false, error: "invalid" };

  // Best-effort media cleanup — never block the DB delete on Cloudinary.
  if (row.publicId && isCloudinaryConfigured()) {
    try {
      await cloudinary.uploader.destroy(row.publicId, {
        resource_type: "image",
        invalidate: true,
      });
    } catch (err) {
      console.error("Cloudinary destroy failed (continuing):", err);
    }
  }

  await db.delete(circulars).where(eq(circulars.id, id));

  for (const path of [
    "/admin/circulars",
    "/teacher/circulars",
    "/student/circulars",
    "/admin",
    "/teacher",
    "/student",
  ]) {
    revalidatePath(path);
  }
  return { ok: true };
}

// ---------- Support tickets ----------

export type CreateTicketInput = {
  category: TicketCategory;
  subject?: string;
  message: string;
};

export type TicketResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "invalid" };

export async function createTicketAction(
  input: CreateTicketInput,
): Promise<TicketResult> {
  const student = await getRoleUser("student");
  if (!student) return { ok: false, error: "forbidden" };

  const message = input.message?.trim();
  if (!message || !TICKET_CATEGORIES.includes(input.category)) {
    return { ok: false, error: "invalid" };
  }

  await db.insert(supportTickets).values({
    studentId: student.id,
    category: input.category,
    subject: input.subject?.trim() || null,
    message,
    status: "open",
  });

  revalidatePath("/student/support");
  revalidatePath("/admin/support");
  revalidatePath("/admin");
  return { ok: true };
}

export type UpdateTicketInput = {
  id: number;
  status: TicketStatus;
  response?: string;
};

export async function updateTicketStatusAction(
  input: UpdateTicketInput,
): Promise<TicketResult> {
  if (!(await getRoleUser("admin"))) {
    return { ok: false, error: "forbidden" };
  }
  if (!TICKET_STATUSES.includes(input.status)) {
    return { ok: false, error: "invalid" };
  }

  await db
    .update(supportTickets)
    .set({
      status: input.status,
      response: input.response?.trim() || null,
      updatedAt: new Date(),
    })
    .where(eq(supportTickets.id, input.id));

  revalidatePath("/admin/support");
  revalidatePath("/student/support");
  return { ok: true };
}
