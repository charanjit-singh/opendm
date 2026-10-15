// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Every outgoing Graph call goes through here: a rolling per-hour cap (Meta throttles accounts that send in bursts),
// an outbox in D1 for anything over the cap or hit by a transient error, and backoff retries from the cron.
import { getAccount, getSetting, graphFor, logEvent, now, setSetting, type Account } from "./store";
import type { GraphResult } from "./graph";
import type { Env } from "./types";

export type Job =
  | { kind: "private_reply"; commentId: string; text: string; ctx: LogCtx }
  | { kind: "dm"; userId: string; text: string; ctx: LogCtx }
  | { kind: "public_reply"; commentId: string; text: string; ctx: LogCtx };

/** What the event log should say about a job. */
export interface LogCtx {
  username?: string | null;
  keyword?: string | null;
  rule_id?: number | null;
  /** The commenter/recipient, for the log. */
  ig_user?: string | null;
}

export const DEFAULT_HOURLY_LIMIT = 150;
export const MAX_ATTEMPTS = 5;
const WINDOW_MS = 3_600_000;

export async function hourlyLimit(env: Env): Promise<number> {
  const n = Number(await getSetting(env, "hourly_limit"));
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_HOURLY_LIMIT;
}

export async function sentLastHour(env: Env): Promise<number> {
  const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM sends WHERE ts > ?").bind(now() - WINDOW_MS).first<{ n: number }>();
  return r?.n ?? 0;
}

const underLimit = async (env: Env) => (await sentLastHour(env)) < (await hourlyLimit(env));

/** Retry delays: 1, 2, 4, 8 minutes... */
export const backoffMs = (attempts: number) => 60_000 * 2 ** Math.max(0, attempts - 1);

async function enqueue(env: Env, job: Job, attempts: number, delayMs: number, error?: string) {
  await env.DB.prepare("INSERT INTO outbox (ts, due, job, attempts, status, error) VALUES (?,?,?,?,'pending',?)").bind(now(), now() + delayMs, JSON.stringify(job), attempts, error ?? null).run();
}

const logKind = (j: Job) => (j.kind === "dm" ? "dm" : "comment");
const logText = (j: Job) => `${j.kind === "public_reply" ? "[public reply] " : j.kind === "private_reply" ? "[private reply] " : ""}${j.text}`;

function call(g: ReturnType<typeof graphFor>, a: Account, j: Job): Promise<GraphResult> {
  if (j.kind === "private_reply") return g.privateReply(a.igId, j.commentId, j.text);
  if (j.kind === "dm") return g.sendDm(a.igId, j.userId, j.text);
  return g.publicReply(j.commentId, j.text);
}

export type SendOutcome = "sent" | "queued" | "error";

/** Runs one job now (or defers it). `attempts` is how many times it already failed. */
async function run(env: Env, job: Job, attempts: number): Promise<SendOutcome> {
  const base = { kind: logKind(job) as "comment" | "dm", ig_user: job.ctx.ig_user ?? (job.kind === "dm" ? job.userId : null), username: job.ctx.username, keyword: job.ctx.keyword, rule_id: job.ctx.rule_id, comment_id: job.kind !== "dm" ? job.commentId : null, text: logText(job) };
  const acct = await getAccount(env);
  if (!acct) {
    await logEvent(env, { ...base, status: "error", error: "no Instagram account connected" });
    return "error";
  }
  if (!(await underLimit(env))) {
    await enqueue(env, job, attempts, 60_000);
    await logEvent(env, { ...base, status: "queued", error: `over the ${await hourlyLimit(env)}/hour cap, will send shortly` });
    return "queued";
  }
  await env.DB.prepare("INSERT INTO sends (ts) VALUES (?)").bind(now()).run();
  const r = await call(graphFor(env, acct), acct, job);
  if (r.ok) {
    await logEvent(env, { ...base, status: "sent" });
    return "sent";
  }
  if (r.kind === "retry" && attempts + 1 < MAX_ATTEMPTS) {
    await enqueue(env, job, attempts + 1, backoffMs(attempts + 1), r.error);
    await logEvent(env, { ...base, status: "queued", error: `retrying: ${r.error}` });
    return "queued";
  }
  if (r.kind === "token") await setSetting(env, "token_error", `${new Date().toISOString()} ${r.error}`);
  await logEvent(env, { ...base, status: "error", error: `${r.kind}: ${r.error}` });
  return "error";
}

export const dispatch = (env: Env, job: Job) => run(env, job, 0);

/** Cron: send what is due. Stops early once the hourly cap is hit. */
export async function drainOutbox(env: Env, max = 25): Promise<number> {
  const { results } = await env.DB.prepare("SELECT id, job, attempts FROM outbox WHERE status = 'pending' AND due <= ? ORDER BY id LIMIT ?").bind(now(), max).all<{ id: number; job: string; attempts: number }>();
  let done = 0;
  for (const row of results) {
    if (!(await underLimit(env))) break;
    await env.DB.prepare("UPDATE outbox SET status = 'sent' WHERE id = ?").bind(row.id).run();
    await run(env, JSON.parse(row.job) as Job, row.attempts);
    done++;
  }
  return done;
}
