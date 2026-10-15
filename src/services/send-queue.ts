// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Every outgoing Graph call goes through here: a rolling per-hour cap (Meta throttles accounts that send in bursts),
// an outbox in D1 for anything over the cap or hit by a transient error, and backoff retries driven by the cron.
import { getAccount } from "../db/account";
import { logEvent } from "../db/events";
import { getNumberSetting, SETTING, setSetting } from "../db/settings";
import type { Env } from "../types/env";
import { type GraphResult, graphClientFor } from "./graph";

/** What the event log should say about a job. */
export interface LogContext {
  username?: string | null;
  keyword?: string | null;
  rule_id?: number | null;
  ig_user?: string | null;
}

export type Job =
  | { kind: "private_reply"; commentId: string; text: string; ctx: LogContext }
  | { kind: "dm"; userId: string; text: string; ctx: LogContext }
  | { kind: "public_reply"; commentId: string; text: string; ctx: LogContext };

export type SendOutcome = "sent" | "queued" | "error";

export const DEFAULT_HOURLY_LIMIT = 150;
export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 3_600_000;
const QUEUE_DELAY_MS = 60_000;

export const hourlyLimit = async (env: Env): Promise<number> =>
  (await getNumberSetting(env, SETTING.hourlyLimit)) ?? DEFAULT_HOURLY_LIMIT;

export async function sentLastHour(env: Env): Promise<number> {
  const row = await env.DB.prepare("SELECT COUNT(*) AS n FROM sends WHERE ts > ?").bind(Date.now() - WINDOW_MS).first<{ n: number }>();
  return row?.n ?? 0;
}

const isUnderLimit = async (env: Env): Promise<boolean> => (await sentLastHour(env)) < (await hourlyLimit(env));

/** Retry delays: 1, 2, 4, 8 minutes. */
export const backoffMs = (attempts: number): number => 60_000 * 2 ** Math.max(0, attempts - 1);

async function enqueue(env: Env, job: Job, attempts: number, delayMs: number, error?: string): Promise<void> {
  const now = Date.now();
  await env.DB
    .prepare("INSERT INTO outbox (ts, due, job, attempts, status, error) VALUES (?,?,?,?,'pending',?)")
    .bind(now, now + delayMs, JSON.stringify(job), attempts, error ?? null)
    .run();
}

const describeJob = (job: Job) => {
  const label = { private_reply: "[private reply] ", public_reply: "[public reply] ", dm: "" }[job.kind];
  return {
    kind: job.kind === "dm" ? ("dm" as const) : ("comment" as const),
    ig_user: job.ctx.ig_user ?? (job.kind === "dm" ? job.userId : null),
    username: job.ctx.username,
    keyword: job.ctx.keyword,
    rule_id: job.ctx.rule_id,
    comment_id: job.kind === "dm" ? null : job.commentId,
    text: label + job.text,
  };
};

function callGraph(env: Env, job: Job, account: NonNullable<Awaited<ReturnType<typeof getAccount>>>): Promise<GraphResult> {
  const graph = graphClientFor(env, account);
  switch (job.kind) {
    case "private_reply":
      return graph.privateReply(account.igId, job.commentId, job.text);
    case "dm":
      return graph.sendDm(account.igId, job.userId, job.text);
    case "public_reply":
      return graph.publicReply(job.commentId, job.text);
  }
}

/** Runs one job now, or defers it. `attempts` is how many times it has already failed. */
async function run(env: Env, job: Job, attempts: number): Promise<SendOutcome> {
  const log = describeJob(job);
  const account = await getAccount(env);
  if (!account) {
    await logEvent(env, { ...log, status: "error", error: "no Instagram account connected" });
    return "error";
  }
  if (!(await isUnderLimit(env))) {
    await enqueue(env, job, attempts, QUEUE_DELAY_MS);
    await logEvent(env, { ...log, status: "queued", error: `over the ${await hourlyLimit(env)}/hour cap, will send shortly` });
    return "queued";
  }
  await env.DB.prepare("INSERT INTO sends (ts) VALUES (?)").bind(Date.now()).run();
  const result = await callGraph(env, job, account);
  if (result.ok) {
    await logEvent(env, { ...log, status: "sent" });
    return "sent";
  }
  if (result.kind === "retry" && attempts + 1 < MAX_ATTEMPTS) {
    await enqueue(env, job, attempts + 1, backoffMs(attempts + 1), result.error);
    await logEvent(env, { ...log, status: "queued", error: `retrying: ${result.error}` });
    return "queued";
  }
  if (result.kind === "token") await setSetting(env, SETTING.tokenError, `${new Date().toISOString()} ${result.error}`);
  await logEvent(env, { ...log, status: "error", error: `${result.kind}: ${result.error}` });
  return "error";
}

export const dispatch = (env: Env, job: Job): Promise<SendOutcome> => run(env, job, 0);

interface OutboxRow {
  id: number;
  job: string;
  attempts: number;
}

/** Cron: send what is due. Stops early once the hourly cap is reached. Returns how many jobs it ran. */
export async function drainOutbox(env: Env, max = 25): Promise<number> {
  const { results } = await env.DB
    .prepare("SELECT id, job, attempts FROM outbox WHERE status = 'pending' AND due <= ? ORDER BY id LIMIT ?")
    .bind(Date.now(), max)
    .all<OutboxRow>();
  let ran = 0;
  for (const row of results) {
    if (!(await isUnderLimit(env))) break;
    await env.DB.prepare("UPDATE outbox SET status = 'sent' WHERE id = ?").bind(row.id).run();
    await run(env, JSON.parse(row.job) as Job, row.attempts);
    ran++;
  }
  return ran;
}
