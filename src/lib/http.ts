// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Context } from "hono";

export const SESSION_COOKIE = "opendm_session";
export const SESSION_TTL_SECONDS = 7 * 86_400;

/** The client address Cloudflare saw, or "local" in development. */
export const clientIp = (c: Context): string => c.req.header("CF-Connecting-IP") ?? "local";

/** Set-Cookie value for the admin session. `Secure` is added on https only so `wrangler dev` still works. */
export function sessionCookie(value: string, maxAgeSeconds: number, requestUrl: string): string {
  const secure = new URL(requestUrl).protocol === "https:" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAgeSeconds}${secure}`;
}
