// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { getAccount, saveAccount } from "../db/accounts";
import { logEvent } from "../db/events";
import { getSetting, SETTING, setSetting } from "../db/settings";
import type { Env } from "../types/env";
import { graphBaseFor } from "./account-client";
import { Graph } from "./graph";

const DAY_MS = 86_400_000;

/** Instagram user tokens last 60 days. Refresh once the token is a day old and under 20 days from expiry (or the expiry is unknown). */
export async function refreshTokenIfNeeded(env: Env, force = false): Promise<string> {
  const account = await getAccount(env, "instagram");
  if (!account || account.mode !== "instagram_login") return "no Instagram Login token to refresh";
  const expires = Number((await getSetting(env, SETTING.tokenExpires)) ?? 0);
  const refreshed = Number((await getSetting(env, SETTING.tokenRefreshed)) ?? 0);
  if (!force && refreshed && Date.now() - refreshed < DAY_MS) return "refreshed in the last day";
  if (!force && expires && expires - Date.now() > 20 * DAY_MS) return "fresh enough";

  const result = await new Graph(account.token, graphBaseFor(env, account)).refresh();
  if (!result.ok) {
    await setSetting(env, SETTING.tokenError, `${new Date().toISOString()} refresh failed: ${result.error}`);
    await logEvent(env, { kind: "system", status: "error", error: `token refresh failed: ${result.error}` });
    return `refresh failed: ${result.error}`;
  }
  await saveAccount(env, {
    token: result.data.access_token,
    igId: account.accountId,
    username: account.username,
    expiresInSec: result.data.expires_in,
  });
  await logEvent(env, { kind: "system", status: "info", error: "Instagram token refreshed" });
  return "refreshed";
}
