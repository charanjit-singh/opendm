// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Env } from "../types/env";

/** Keys used in the `settings` table. */
export const SETTING = {
  enabled: "enabled",
  hourlyLimit: "hourly_limit",
  lastPublicReply: "last_public_reply",
  igToken: "ig_token",
  igUserId: "ig_user_id",
  igUsername: "ig_username",
  tokenError: "token_error",
  tokenExpires: "token_expires",
  tokenRefreshed: "token_refreshed",
} as const;

export async function getSetting(env: Env, key: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return row?.value ?? null;
}

/** Stores a value; `null` deletes the key. */
export async function setSetting(env: Env, key: string, value: string | null): Promise<void> {
  if (value === null) {
    await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
    return;
  }
  await env.DB.prepare(
    "INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated",
  )
    .bind(key, value, Date.now())
    .run();
}

export async function getNumberSetting(env: Env, key: string): Promise<number | null> {
  const n = Number(await getSetting(env, key));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** The global on/off switch. On unless explicitly switched off. */
export const isEnabled = async (env: Env): Promise<boolean> => (await getSetting(env, SETTING.enabled)) !== "0";
