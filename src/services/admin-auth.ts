// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { countFailedLogins, logEvent } from "../db/events";
import { safeEqual } from "../lib/crypto";
import type { Env } from "../types/env";

const MAX_FAILURES = 10;
const LOCKOUT_WINDOW_MS = 15 * 60_000;

export type PasswordCheck = { ok: true } | { ok: false; status: 401 | 429; error: string };

/** Checks the admin password, locking an address out after too many failures. Used by the login form and by API tokens. */
export async function checkAdminPassword(env: Env, ip: string, candidate: unknown): Promise<PasswordCheck> {
  if ((await countFailedLogins(env, ip, Date.now() - LOCKOUT_WINDOW_MS)) >= MAX_FAILURES) {
    return { ok: false, status: 429, error: "Too many attempts, try again in 15 minutes" };
  }
  if (typeof candidate === "string" && env.ADMIN_PASSWORD && (await safeEqual(candidate, env.ADMIN_PASSWORD))) {
    return { ok: true };
  }
  await logEvent(env, { kind: "auth", status: "error", ig_user: ip, error: "bad password" });
  return { ok: false, status: 401, error: "Wrong password" };
}
