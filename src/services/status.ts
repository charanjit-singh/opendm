// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { getAccount } from "../db/accounts";
import { getAppCredentials } from "../db/app-credentials";
import { getSetting, isEnabled, SETTING } from "../db/settings";
import type { ChannelStatus, Platform, Status } from "../types/api";
import type { Env } from "../types/env";
import { DEFAULT_FLOW, DEFAULT_PUBLIC_REPLIES } from "./flow";
import { hourlyLimit, sentLastHour } from "./send-queue";

const DAY_MS = 86_400_000;

async function channelStatus(env: Env, platform: Platform): Promise<ChannelStatus> {
  const account = await getAccount(env, platform);
  const errorKey = platform === "facebook" ? SETTING.fbTokenError : SETTING.tokenError;
  return {
    connected: !!account,
    mode: account?.mode ?? null,
    name: account?.username ?? null,
    id: account?.accountId ?? null,
    tokenError: await getSetting(env, errorKey),
  };
}

/** Everything the dashboard overview needs in one call. */
export async function buildStatus(env: Env, origin: string): Promise<Status> {
  const [instagram, facebook] = await Promise.all([channelStatus(env, "instagram"), channelStatus(env, "facebook")]);
  const [rules, sent24h, steps] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM rules").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind IN ('comment','dm') AND status = 'sent' AND ts > ?")
      .bind(Date.now() - DAY_MS)
      .first<{ n: number }>(),
    env.DB.prepare("SELECT step, COUNT(*) AS n FROM conversations GROUP BY step").all<{ step: string; n: number }>(),
  ]);
  return {
    enabled: await isEnabled(env),
    connected: instagram.connected,
    username: instagram.name,
    igId: instagram.id,
    channels: { instagram, facebook },
    tokenError: instagram.tokenError,
    tokenExpires: Number((await getSetting(env, SETTING.tokenExpires)) ?? 0) || null,
    webhookUrl: `${origin}/webhook`,
    verifyTokenSet: !!env.VERIFY_TOKEN,
    verifyToken: env.VERIFY_TOKEN,
    oauthAvailable: !!(await getAppCredentials(env, "instagram")).id,
    facebookOauthAvailable: !!(await getAppCredentials(env, "facebook")).id,
    rules: rules?.n ?? 0,
    sent24h: sent24h?.n ?? 0,
    sentLastHour: await sentLastHour(env),
    hourlyLimit: await hourlyLimit(env),
    conversations: Object.fromEntries(steps.results.map((r) => [r.step, r.n])) as Status["conversations"],
    defaults: { flow: DEFAULT_FLOW, publicReplies: DEFAULT_PUBLIC_REPLIES },
  };
}
