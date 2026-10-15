// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { seal, unseal } from "../lib/crypto";
import type { LoginMode, Platform } from "../types/api";
import type { Env } from "../types/env";
import { getSetting, SETTING, setSetting } from "./settings";

/** A connected messaging account: which platform, how it logged in, and the token that acts for it. */
export interface Account {
  platform: Platform;
  mode: LoginMode;
  token: string;
  /** The id in `/{id}/messages`: the Instagram user id (Instagram Login) or the Facebook Page id (Facebook Login). */
  ownerId: string;
  /** The Instagram professional account id, or the Facebook Page id. */
  accountId: string;
  /** Instagram username, or the Page name. Used for {account} in messages. */
  username: string | null;
}

const readSealed = async (env: Env, key: string) => unseal(env.SESSION_SECRET, await getSetting(env, key));

/** The Facebook Page connection, if any. */
async function pageConnection(env: Env) {
  const token = await readSealed(env, SETTING.fbToken);
  const pageId = await getSetting(env, SETTING.fbPageId);
  if (!token || !pageId) return null;
  return {
    token,
    pageId,
    pageName: await getSetting(env, SETTING.fbPageName),
    igId: await getSetting(env, SETTING.fbIgId),
    igUsername: await getSetting(env, SETTING.fbIgUsername),
  };
}

/**
 * The account for a platform.
 *  - instagram: an Instagram Login token if connected, else the linked Instagram account of the connected Page (Facebook Login).
 *  - facebook: the connected Page.
 */
export async function getAccount(env: Env, platform: Platform = "instagram"): Promise<Account | null> {
  if (platform === "instagram") {
    const token = await readSealed(env, SETTING.igToken);
    const igId = await getSetting(env, SETTING.igUserId);
    if (token && igId) {
      const username = await getSetting(env, SETTING.igUsername);
      return { platform, mode: "instagram_login", token, ownerId: igId, accountId: igId, username };
    }
    const page = await pageConnection(env);
    if (page?.igId) {
      return {
        platform,
        mode: "facebook_login",
        token: page.token,
        ownerId: page.pageId,
        accountId: page.igId,
        username: page.igUsername,
      };
    }
    return null;
  }
  const page = await pageConnection(env);
  if (!page) return null;
  return {
    platform,
    mode: "facebook_login",
    token: page.token,
    ownerId: page.pageId,
    accountId: page.pageId,
    username: page.pageName,
  };
}

export interface SaveAccountInput {
  token: string;
  igId: string;
  username?: string | null;
  expiresInSec?: number;
}

/** Saves an Instagram Login connection. */
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

export interface SavePageInput {
  token: string;
  pageId: string;
  name?: string | null;
  igId?: string | null;
  igUsername?: string | null;
}

/** Saves a Facebook Page connection (Page access token) and the Instagram account linked to it, if any. */
export async function savePage(env: Env, input: SavePageInput): Promise<void> {
  await setSetting(env, SETTING.fbToken, await seal(env.SESSION_SECRET, input.token));
  await setSetting(env, SETTING.fbPageId, input.pageId);
  await setSetting(env, SETTING.fbPageName, input.name ?? null);
  await setSetting(env, SETTING.fbIgId, input.igId ?? null);
  await setSetting(env, SETTING.fbIgUsername, input.igUsername ?? null);
  await setSetting(env, SETTING.fbTokenError, null);
  await setSetting(env, SETTING.fbUserToken, null);
}

export async function clearPage(env: Env): Promise<void> {
  for (const key of [
    SETTING.fbToken,
    SETTING.fbPageId,
    SETTING.fbPageName,
    SETTING.fbIgId,
    SETTING.fbIgUsername,
    SETTING.fbTokenError,
    SETTING.fbUserToken,
  ]) {
    await setSetting(env, key, null);
  }
}

export const saveUserToken = async (env: Env, token: string) =>
  setSetting(env, SETTING.fbUserToken, await seal(env.SESSION_SECRET, token));
export const getUserToken = (env: Env) => readSealed(env, SETTING.fbUserToken);
