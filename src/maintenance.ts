// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Cron work: send what is queued, close stale follow gates, keep the Instagram token alive, tidy old rows.
import { processFollowTimeouts } from "./engine";
import { drainOutbox } from "./queue";
import { getAccount, getSetting, graphFor, logEvent, now, prune, saveAccount, setSetting } from "./store";
import type { Env } from "./types";

const DAY = 86_400_000;

/** Instagram user tokens last 60 days; refresh once it is a day old and under 20 days from expiry (or the expiry is unknown). */
export async function refreshTokenIfNeeded(env: Env): Promise<string> {
  const acct = await getAccount(env);
  if (!acct || !(await getSetting(env, "ig_token"))) return "no stored token";
  const expires = Number((await getSetting(env, "token_expires")) ?? 0);
  const refreshed = Number((await getSetting(env, "token_refreshed")) ?? 0);
  if (refreshed && now() - refreshed < DAY) return "refreshed in the last day";
  if (expires && expires - now() > 20 * DAY) return "fresh enough";
  const r = await graphFor(env, acct).refresh();
  if (!r.ok) {
    await setSetting(env, "token_error", `${new Date().toISOString()} refresh failed: ${r.error}`);
    await logEvent(env, { kind: "system", status: "error", error: `token refresh failed: ${r.error}` });
    return `refresh failed: ${r.error}`;
  }
  await saveAccount(env, { token: r.data.access_token, igId: acct.igId, username: acct.username, expiresInSec: r.data.expires_in });
  await logEvent(env, { kind: "system", status: "info", error: "Instagram token refreshed" });
  return "refreshed";
}

export async function runCron(env: Env): Promise<Record<string, unknown>> {
  const sent = await drainOutbox(env);
  const timeouts = await processFollowTimeouts(env);
  const token = await refreshTokenIfNeeded(env);
  await prune(env);
  return { sent, timeouts, token };
}
