// Client-side helpers for rendering the structured field errors that server
// actions return. Pure — no "server-only", safe to import from a Client
// Component.
//
// Server actions return `{ error: "validation", fieldErrors: { email: "…" } }`.
// `fieldErrors` is a flat map of field path -> message, where every message
// describes the CALLER'S OWN input. Nothing in it describes the server, so it is
// safe to show verbatim.

import type { FieldErrors } from "./core";

export type { FieldErrors };

/**
 * The first field message, formatted for appending to an existing error line —
 * lets a form surface the specific problem ("Enter a valid email address")
 * without adding any new markup.
 *
 * Returns "" when there is nothing to show, so callers can concatenate freely.
 */
export function fieldErrorSuffix(fieldErrors?: FieldErrors): string {
  if (!fieldErrors) return "";
  const entries = Object.entries(fieldErrors);
  if (entries.length === 0) return "";

  const [path, message] = entries[0];
  // `_form` marks a whole-payload issue (e.g. an unrecognized key); there is no
  // field name worth showing the user in that case.
  const detail = path === "_form" ? message : `${humanizeField(path)}: ${message}`;
  const more =
    entries.length > 1 ? ` (+${entries.length - 1} more)` : "";
  return ` — ${detail}${more}`;
}

/** "practicalBatch" -> "Practical batch"; "records.3.status" -> "Records 3 status". */
function humanizeField(path: string): string {
  const words = path
    .split(".")
    .flatMap((part) => part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(" "))
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}
