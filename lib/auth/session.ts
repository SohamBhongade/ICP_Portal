// Session token signing/verification — Edge-safe (Web Crypto only).
//
// IMPORTANT: this file must stay free of Node-only / DB imports because it's
// imported by proxy.ts (Next 16's renamed middleware), which runs on the Edge
// runtime. It uses globalThis.crypto.subtle, which exists in BOTH Edge and
// modern Node, so the same implementation works everywhere.
//
// Token format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 sig)

import type { Locale } from "@/lib/i18n/config";
import type { Role } from "./permissions";

// Re-export so existing `import { type Role } from "@/lib/auth/session"` callers
// keep working; the canonical definition now lives in ./permissions.
export type { Role };

export const SESSION_COOKIE = "icp_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type SessionPayload = {
  userId: number;
  role: Role;
  name: string;
  preferredLanguage: Locale;
  exp: number; // epoch ms
};

/**
 * Thrown when AUTH_SECRET itself is misconfigured. Distinct from an invalid or
 * expired token so verifySessionToken can RE-THROW it instead of swallowing it:
 * a bad secret must surface as a loud server error, never as "everyone is
 * quietly signed out" (which would look like a working app with no sessions).
 */
export class AuthConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthConfigError";
  }
}

// Minimum acceptable secret length. 32 chars is the floor for an HMAC-SHA256
// key with a sensible margin; `openssl rand -hex 32` produces 64.
const MIN_SECRET_LENGTH = 32;

// Values that show up in tutorials, .env.example files and copy-pasted configs.
// Compared case-insensitively; any match is treated as "no secret at all".
const PLACEHOLDER_SECRETS = new Set([
  "secret",
  "changeme",
  "change-me",
  "your-secret-here",
  "your_secret_here",
  "auth_secret",
  "authsecret",
  "development",
  "dev",
  "test",
  "password",
  "supersecret",
  "super-secret",
  "replace-me",
  "todo",
]);

/**
 * Read AUTH_SECRET and FAIL CLOSED if it is missing or weak.
 *
 * There is deliberately NO fallback default: an app that silently signs tokens
 * with a guessable key is worse than one that refuses to start, because every
 * session cookie it ever issued would be forgeable. Rejected cases:
 *   - unset / empty
 *   - shorter than MIN_SECRET_LENGTH
 *   - a well-known placeholder value
 *   - a single repeated character (e.g. "aaaa…")
 */
function getSecret(): string {
  const secret = process.env.AUTH_SECRET;

  if (!secret || !secret.trim()) {
    throw new AuthConfigError(
      "AUTH_SECRET is not set. Session signing is disabled and every request " +
        "will fail closed. Generate one with `openssl rand -hex 32` and add it " +
        "to .env.local (and to your hosting provider's environment).",
    );
  }

  const value = secret.trim();

  if (value.length < MIN_SECRET_LENGTH) {
    throw new AuthConfigError(
      `AUTH_SECRET is too weak: ${value.length} characters, minimum is ` +
        `${MIN_SECRET_LENGTH}. A short key makes session cookies forgeable. ` +
        "Regenerate it with `openssl rand -hex 32`.",
    );
  }

  if (PLACEHOLDER_SECRETS.has(value.toLowerCase())) {
    throw new AuthConfigError(
      "AUTH_SECRET is a well-known placeholder value. Session cookies signed " +
        "with it are trivially forgeable. Regenerate it with " +
        "`openssl rand -hex 32`.",
    );
  }

  if (new Set(value).size === 1) {
    throw new AuthConfigError(
      "AUTH_SECRET is a single repeated character and carries no entropy. " +
        "Regenerate it with `openssl rand -hex 32`.",
    );
  }

  return value;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  let s = value.replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 === 0 ? 0 : 4 - (s.length % 4);
  s += "=".repeat(pad);
  const bin = atob(s);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Cast helper: TS's DOM lib types BufferSource as ArrayBufferView<ArrayBuffer>,
// but TextEncoder/our decoder produce Uint8Array<ArrayBufferLike>. They are
// runtime-compatible, so we cast at the crypto boundary.
const buf = (u: Uint8Array): BufferSource => u as unknown as BufferSource;

async function getKey(): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    buf(encoder.encode(getSecret())),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Create a signed session token from a payload (sans exp — added here). */
export async function createSessionToken(
  payload: Omit<SessionPayload, "exp">,
): Promise<string> {
  const full: SessionPayload = {
    ...payload,
    exp: Date.now() + SESSION_MAX_AGE_SECONDS * 1000,
  };
  const data = bytesToBase64Url(encoder.encode(JSON.stringify(full)));
  const key = await getKey();
  const sig = await crypto.subtle.sign("HMAC", key, buf(encoder.encode(data)));
  return `${data}.${bytesToBase64Url(new Uint8Array(sig))}`;
}

/** Verify a token and return its payload, or null if invalid/expired/tampered. */
export async function verifySessionToken(
  token: string | undefined | null,
): Promise<SessionPayload | null> {
  if (!token) return null;
  const [data, sig] = token.split(".");
  if (!data || !sig) return null;

  try {
    const key = await getKey();
    const valid = await crypto.subtle.verify(
      "HMAC",
      key,
      buf(base64UrlToBytes(sig)),
      buf(encoder.encode(data)),
    );
    if (!valid) return null;

    const payload = JSON.parse(
      decoder.decode(base64UrlToBytes(data)),
    ) as SessionPayload;

    // Expiry is MANDATORY and re-checked on every single verification, so a
    // token with no exp, a non-numeric exp, or a past exp is never accepted.
    if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch (err) {
    // A misconfigured AUTH_SECRET is an operator error, not a bad token —
    // re-throw so it surfaces loudly instead of masquerading as "signed out".
    if (err instanceof AuthConfigError) throw err;
    return null;
  }
}
