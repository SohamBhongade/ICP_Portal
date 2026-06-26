"use client";

// Staff circular publisher. The attachment is uploaded DIRECTLY to Cloudinary
// using a signed ticket minted by a server action (the bytes never touch our
// server); only the resulting URL + metadata are then persisted.

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Megaphone, Paperclip, Upload } from "lucide-react";
import { useT } from "@/components/i18n/LanguageProvider";
import { Editable } from "@/components/edit-mode/Editable";
import {
  createCircularAction,
  requestCircularUploadAction,
} from "@/app/actions/support";

export function CircularComposer() {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; msg: string } | null>(
    null,
  );

  const notify = (kind: "success" | "error", msg: string) => {
    setToast({ kind, msg });
    window.setTimeout(() => setToast(null), 5000);
  };

  const reset = () => {
    setTitle("");
    setDescription("");
    setFile(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return notify("error", t("circulars.toast.needTitle"));
    if (!file) return notify("error", t("circulars.toast.needFile"));

    startTransition(async () => {
      try {
        const ticket = await requestCircularUploadAction();
        if (!ticket.ok) {
          return notify(
            "error",
            ticket.error === "unconfigured"
              ? t("circulars.toast.unconfigured")
              : t("circulars.toast.forbidden"),
          );
        }

        // Direct, signed upload to Cloudinary's auto endpoint.
        const fd = new FormData();
        fd.append("file", file);
        fd.append("api_key", ticket.apiKey);
        fd.append("timestamp", String(ticket.timestamp));
        fd.append("signature", ticket.signature);
        fd.append("folder", ticket.folder);

        const res = await fetch(
          `https://api.cloudinary.com/v1_1/${ticket.cloudName}/auto/upload`,
          { method: "POST", body: fd },
        );
        if (!res.ok) return notify("error", t("circulars.toast.uploadFailed"));

        const data = (await res.json()) as {
          secure_url?: string;
          public_id?: string;
          format?: string;
        };
        if (!data.secure_url) {
          return notify("error", t("circulars.toast.uploadFailed"));
        }

        const fileType =
          data.format === "pdf" || file.type === "application/pdf"
            ? "pdf"
            : "image";

        const result = await createCircularAction({
          title,
          description,
          fileUrl: data.secure_url,
          fileType,
          cloudinaryPublicId: data.public_id,
        });
        if (!result.ok) return notify("error", t("circulars.toast.failed"));

        reset();
        router.refresh();
        notify("success", t("circulars.toast.published"));
      } catch {
        notify("error", t("circulars.toast.failed"));
      }
    });
  };

  return (
    <div className="rounded-lg border border-line bg-surface p-5 shadow-sm">
      <div className="mb-4 flex items-center gap-2">
        <Megaphone className="size-5 text-primary" />
        <div>
          <h2 className="text-base font-semibold text-ink">
            <Editable tKey="circulars.compose.title" />
          </h2>
          <p className="text-sm text-muted">
            <Editable tKey="circulars.compose.subtitle" />
          </p>
        </div>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label
            htmlFor="circ-title"
            className="mb-1 block text-sm font-medium text-ink"
          >
            {t("circulars.compose.titleLabel")}
          </label>
          <input
            id="circ-title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t("circulars.compose.titlePlaceholder")}
            required
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
          />
        </div>

        <div>
          <label
            htmlFor="circ-desc"
            className="mb-1 block text-sm font-medium text-ink"
          >
            {t("circulars.compose.descriptionLabel")}
          </label>
          <textarea
            id="circ-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("circulars.compose.descriptionPlaceholder")}
            rows={3}
            className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink focus:border-teal"
          />
        </div>

        <div>
          <span className="mb-1 block text-sm font-medium text-ink">
            {t("circulars.compose.fileLabel")}
          </span>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-sm font-medium text-ink hover:bg-lavender"
            >
              <Paperclip className="size-4" /> {t("circulars.compose.choose")}
            </button>
            <span className="min-w-0 truncate text-sm text-muted">
              {file ? file.name : t("circulars.compose.noFile")}
            </span>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,image/*"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <p className="mt-1 text-xs text-muted">
            {t("circulars.compose.fileHint")}
          </p>
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
            <Upload className="size-4" />
            {pending
              ? t("circulars.compose.publishing")
              : t("circulars.compose.publish")}
          </button>
        </div>
      </form>
    </div>
  );
}
