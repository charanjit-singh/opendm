// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
const enc = new TextEncoder();

const toHex = (b: ArrayBuffer | Uint8Array) =>
  [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const fromHex = (hex: string) => {
  if (!/^[0-9a-f]+$/i.test(hex) || hex.length % 2) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
};
const b64 = (b: Uint8Array) =>
  btoa(String.fromCharCode(...b))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));

const hmacKey = (secret: string, usage: ("sign" | "verify")[]) =>
  crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, usage);

/** Hex HMAC-SHA256 as Meta sends it: "sha256=<hex>". */
export async function sign(secret: string, body: string | Uint8Array): Promise<string> {
  const data = typeof body === "string" ? enc.encode(body) : body;
  return `sha256=${toHex(await crypto.subtle.sign("HMAC", await hmacKey(secret, ["sign"]), data))}`;
}

/** Checks Meta's X-Hub-Signature-256 header against the raw body. Constant time; anything malformed is a no. */
export async function verifySignature(
  secret: string | undefined,
  raw: Uint8Array,
  header: string | null,
): Promise<boolean> {
  if (!secret || !header?.startsWith("sha256=")) return false;
  const sig = fromHex(header.slice(7));
  if (sig?.length !== 32) return false;
  return crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), sig, raw);
}

/** Constant-time string equality (compares HMACs of both sides, so length does not leak). */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const key = await hmacKey("opendm-compare", ["sign", "verify"]);
  const mac = await crypto.subtle.sign("HMAC", key, enc.encode(a));
  return crypto.subtle.verify("HMAC", key, mac, enc.encode(b));
}

/** Signed, expiring token for the admin cookie and the OAuth state: "<payload>.<hmac>". */
export async function makeToken(secret: string, payload: string, ttlSec: number, now = Date.now()): Promise<string> {
  const body = `${payload}:${Math.floor(now / 1000) + ttlSec}`;
  return `${b64(enc.encode(body))}.${(await sign(secret, body)).slice(7)}`;
}

/** Returns the payload when the signature is valid and not expired, else null. */
export async function readToken(
  secret: string,
  token: string | null | undefined,
  now = Date.now(),
): Promise<string | null> {
  if (!secret || !token) return null;
  const [p, mac] = token.split(".");
  if (!p || !mac) return null;
  let body: string;
  try {
    body = new TextDecoder().decode(unb64(p));
  } catch {
    return null;
  }
  const sig = fromHex(mac);
  if (!sig || !(await crypto.subtle.verify("HMAC", await hmacKey(secret, ["verify"]), sig, enc.encode(body))))
    return null;
  const i = body.lastIndexOf(":");
  const exp = Number(body.slice(i + 1));
  return exp * 1000 > now ? body.slice(0, i) : null;
}

const aesKey = async (secret: string) =>
  crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest("SHA-256", enc.encode(`opendm-tokens:${secret}`)),
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );

/** AES-GCM seal for access tokens stored in D1. */
export async function seal(secret: string, plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), enc.encode(plain)),
  );
  return `${b64(iv)}.${b64(ct)}`;
}

export async function unseal(secret: string, sealed: string | null | undefined): Promise<string | null> {
  if (!sealed) return null;
  const [iv, ct] = sealed.split(".");
  try {
    return new TextDecoder().decode(
      await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(secret), unb64(ct)),
    );
  } catch {
    return null;
  }
}

/** Error text safe to store or show: never a token. */
export function scrub(s: string, secrets: (string | undefined | null)[] = []): string {
  let out = s;
  for (const x of secrets) if (x && x.length > 8) out = out.split(x).join("[token]");
  return out.replace(/\b(EAA|IGAA|IGQ)[A-Za-z0-9_-]{20,}/g, "[token]").slice(0, 400);
}
