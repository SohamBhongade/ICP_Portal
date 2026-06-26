// Session token signing/verification — Edge-safe (Web Crypto only).
//
// IMPORTANT: this file must stay free of Node-only / DB imports because it's
// imported by proxy.ts (Next 16's renamed middleware), which runs on the Edge
// runtime. It uses globalThis.crypto.subtle, which exists in BOTH Edge and
// modern Node, so the same implementation works everywhere.
//
// Token format:  base64url(JSON payload) + "." + base64url(HMAC-SHA256 sig)

import type { Locale } from "@/lib/i18n/config";

export const SESSION_COOKIE = "icp_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days

export type Role = "admin" | "teacher" | "student";

export type SessionPayload = {
  userId: number;
  role: Role;
  name: string;
  preferredLanguage: Locale;
  exp: number; // epoch ms
};

function getSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Add a strong random value to .env.local.",
    );
  }
  return secret;
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

    if (typeof payload.exp !== "number" || Date.now() > payload.exp) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}
