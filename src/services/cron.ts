// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { pruneOldRows } from "../db/events";
import type { Env } from "../types/env";
import { processFollowTimeouts } from "./follow-timeouts";
import { drainOutbox } from "./send-queue";
import { refreshTokenIfNeeded } from "./token-refresh";

/** The once-a-minute job: send what is queued, close stale follow gates, keep the token alive, tidy old rows. */
export async function runCron(env: Env): Promise<{ sent: number; timeouts: number; token: string }> {
  const sent = await drainOutbox(env);
  const timeouts = await processFollowTimeouts(env);
  const token = await refreshTokenIfNeeded(env);
  await pruneOldRows(env);
  return { sent, timeouts, token };
}
