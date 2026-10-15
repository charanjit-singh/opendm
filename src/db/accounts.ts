// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { seal, unseal } from "../lib/crypto";
import type { Env } from "../types/env";
import { getSetting, SETTING, setSetting } from "./settings";

/** The connected Instagram account: its access token and Instagram user id. */
export interface Account {
  token: string;
  igId: string;
  username: string | null;
}

/** The account connected in the dashboard. The token is stored sealed (AES-GCM) in D1. */
export async function getAccount(env: Env): Promise<Account | null> {
  const token = await unseal(env.SESSION_SECRET, await getSetting(env, SETTING.igToken));
  const igId = await getSetting(env, SETTING.igUserId);
  if (!token || !igId) return null;
  return { token, igId, username: await getSetting(env, SETTING.igUsername) };
}

export interface SaveAccountInput {
  token: string;
  igId: string;
  username?: string | null;
  expiresInSec?: number;
}

export async function saveAccount(env: Env, input: SaveAccountInput): Promise<void> {
  const now = Date.now();
  await setSetting(env, SETTING.igToken, await seal(env.SESSION_SECRET, input.token));
  await setSetting(env, SETTING.igUserId, input.igId);
  await setSetting(env, SETTING.igUsername, input.username ?? null);
  await setSetting(env, SETTING.tokenError, null);
  await setSetting(env, SETTING.tokenRefreshed, String(now));
  await setSetting(env, SETTING.tokenExpires, input.expiresInSec ? String(now + input.expiresInSec * 1000) : null);
}

export async function clearAccount(env: Env): Promise<void> {
  for (const key of [
    SETTING.igToken,
    SETTING.igUserId,
    SETTING.igUsername,
    SETTING.tokenError,
    SETTING.tokenExpires,
    SETTING.tokenRefreshed,
  ]) {
    await setSetting(env, key, null);
  }
}
