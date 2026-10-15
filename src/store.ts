// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// D1 access: settings, rules, conversations, event log, dedupe.
import { seal, unseal } from "./crypto";
import { DEFAULT_GRAPH, DEFAULT_OAUTH, Graph } from "./graph";
import { resolveFlow, type ConvState, type Flow, type Step } from "./flow";
import { splitKeywords } from "./match";
import type { Env } from "./types";

export const now = () => Date.now();

// ---- settings -------------------------------------------------------------------------------------------------
export async function getSetting(env: Env, key: string): Promise<string | null> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string }>();
  return r?.value ?? null;
}

export async function setSetting(env: Env, key: string, value: string | null): Promise<void> {
  if (value === null) await env.DB.prepare("DELETE FROM settings WHERE key = ?").bind(key).run();
  else await env.DB.prepare("INSERT INTO settings (key, value, updated) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated = excluded.updated").bind(key, value, now()).run();
}

export const isEnabled = async (env: Env) => (await getSetting(env, "enabled")) !== "0";

export interface Account {
  token: string;
  igId: string;
  username: string | null;
}

/** The connected account: the token pasted or OAuth'd in the dashboard (sealed in D1) and its Instagram account id. */
export async function getAccount(env: Env): Promise<Account | null> {
  const token = await unseal(env.SESSION_SECRET, await getSetting(env, "ig_token"));
  const igId = await getSetting(env, "ig_user_id");
  if (!token || !igId) return null;
  return { token, igId, username: await getSetting(env, "ig_username") };
}

export async function saveAccount(env: Env, a: { token: string; igId: string; username?: string | null; expiresInSec?: number }): Promise<void> {
  await setSetting(env, "ig_token", await seal(env.SESSION_SECRET, a.token));
  await setSetting(env, "ig_user_id", a.igId);
  await setSetting(env, "ig_username", a.username ?? null);
  await setSetting(env, "token_error", null);
  await setSetting(env, "token_refreshed", String(now()));
  await setSetting(env, "token_expires", a.expiresInSec ? String(now() + a.expiresInSec * 1000) : null);
}

export async function clearAccount(env: Env): Promise<void> {
  for (const k of ["ig_token", "ig_user_id", "ig_username", "token_error", "token_expires", "token_refreshed"]) await setSetting(env, k, null);
}

export const graphFor = (env: Env, a: Account) => new Graph(a.token, env.GRAPH_BASE || DEFAULT_GRAPH, env.OAUTH_BASE || DEFAULT_OAUTH);

// ---- rules ----------------------------------------------------------------------------------------------------
export interface Rule {
  id: number;
  name: string;
  keywords: string[];
  media_id: string | null;
  enabled: boolean;
  link: string;
  public_replies: string[];
  fuzzy: boolean;
  flow: Flow;
  /** The raw overrides, so the editor shows what the user actually set. */
  flow_raw: Record<string, unknown>;
}

const parse = <T>(s: string, d: T): T => {
  try {
    return JSON.parse(s) as T;
  } catch {
    return d;
  }
};

const toRule = (r: any): Rule => ({
  id: r.id,
  name: r.name,
  keywords: parse<string[]>(r.keywords, []),
  media_id: r.media_id || null,
  enabled: !!r.enabled,
  link: r.link,
  public_replies: parse<string[]>(r.public_replies, []),
  fuzzy: !!r.fuzzy,
  flow: resolveFlow(parse(r.flow, {})),
  flow_raw: parse(r.flow, {}),
});

export async function listRules(env: Env): Promise<Rule[]> {
  const { results } = await env.DB.prepare("SELECT * FROM rules ORDER BY id").all();
  return results.map(toRule);
}

export async function getRule(env: Env, id: number): Promise<Rule | null> {
  const r = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first();
  return r ? toRule(r) : null;
}

export interface RuleInput {
  name?: unknown;
  keywords?: unknown;
  media_id?: unknown;
  enabled?: unknown;
  link?: unknown;
  public_replies?: unknown;
  fuzzy?: unknown;
  flow?: unknown;
}

/** Validates the editor payload. Returns the clean row, or an error message. */
export interface CleanRule {
  name: string;
  keywords: string[];
  media_id: string | null;
  enabled: boolean;
  link: string;
  public_replies: string[];
  fuzzy: boolean;
  flow: Record<string, unknown>;
}

export function cleanRule(b: RuleInput): { ok: true; row: CleanRule } | { ok: false; error: string } {
  const keywords = splitKeywords(Array.isArray(b.keywords) ? (b.keywords as string[]) : String(b.keywords ?? ""));
  if (!keywords.length) return { ok: false, error: "Add at least one keyword" };
  const link = String(b.link ?? "").trim();
  if (link && !/^https?:\/\//i.test(link)) return { ok: false, error: "Link must start with http:// or https://" };
  const replies = (Array.isArray(b.public_replies) ? (b.public_replies as string[]) : String(b.public_replies ?? "").split("\n")).map((x) => String(x).trim()).filter(Boolean);
  const flowRaw = b.flow && typeof b.flow === "object" ? (b.flow as Record<string, unknown>) : {};
  return {
    ok: true,
    row: {
      name: String(b.name ?? "").trim().slice(0, 80) || keywords[0].toUpperCase(),
      keywords,
      media_id: String(b.media_id ?? "").trim() || null,
      enabled: b.enabled === undefined ? true : !!b.enabled,
      link,
      public_replies: replies.slice(0, 10),
      fuzzy: b.fuzzy === undefined ? true : !!b.fuzzy,
      flow: flowRaw,
    },
  };
}

export async function saveRule(env: Env, id: number | null, row: CleanRule): Promise<number> {
  const args = [row.name, JSON.stringify(row.keywords), row.media_id, row.enabled ? 1 : 0, row.link, JSON.stringify(row.public_replies), JSON.stringify(row.flow), row.fuzzy ? 1 : 0];
  if (id) {
    await env.DB.prepare("UPDATE rules SET name=?, keywords=?, media_id=?, enabled=?, link=?, public_replies=?, flow=?, fuzzy=?, updated=? WHERE id=?").bind(...args, now(), id).run();
    return id;
  }
  const r = await env.DB.prepare("INSERT INTO rules (name, keywords, media_id, enabled, link, public_replies, flow, fuzzy, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?)").bind(...args, now(), now()).run();
  return r.meta.last_row_id as number;
}

export const deleteRule = (env: Env, id: number) => env.DB.batch([env.DB.prepare("DELETE FROM conversations WHERE rule_id = ?").bind(id), env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(id)]);

// ---- conversations --------------------------------------------------------------------------------------------
export interface Conversation extends ConvState {
  id: number;
  ig_user: string;
  rule_id: number;
  username: string | null;
  comment_id: string | null;
}

const toConv = (r: any): Conversation => ({ id: r.id, ig_user: r.ig_user, rule_id: r.rule_id, step: r.step as Step, tries: r.tries, email: r.email, followAskedAt: r.follow_asked_at, username: r.username, comment_id: r.comment_id });

export async function upsertConversation(env: Env, c: { ig_user: string; rule_id: number; username?: string | null; comment_id?: string | null }, s: ConvState): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO conversations (ig_user, rule_id, step, tries, email, username, comment_id, follow_asked_at, started, updated) VALUES (?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(ig_user, rule_id) DO UPDATE SET step=excluded.step, tries=excluded.tries, email=COALESCE(excluded.email, conversations.email), username=COALESCE(excluded.username, conversations.username),
       comment_id=COALESCE(excluded.comment_id, conversations.comment_id), follow_asked_at=excluded.follow_asked_at, updated=excluded.updated`,
  ).bind(c.ig_user, c.rule_id, s.step, s.tries, s.email, c.username ?? null, c.comment_id ?? null, s.followAskedAt, now(), now()).run();
}

/** The conversation a DM from this person belongs to: their most recently updated unfinished one. */
export async function activeConversation(env: Env, igUser: string): Promise<Conversation | null> {
  const r = await env.DB.prepare("SELECT * FROM conversations WHERE ig_user = ? AND step IN ('opened','awaiting_follow','awaiting_email') ORDER BY updated DESC LIMIT 1").bind(igUser).first();
  return r ? toConv(r) : null;
}

export async function followWaiting(env: Env, olderThan: number): Promise<Conversation[]> {
  const { results } = await env.DB.prepare("SELECT * FROM conversations WHERE step = 'awaiting_follow' AND follow_asked_at IS NOT NULL AND follow_asked_at <= ?").bind(olderThan).all();
  return results.map(toConv);
}

// ---- events + dedupe ------------------------------------------------------------------------------------------
export type EventStatus = "sent" | "queued" | "skipped" | "error" | "info";
export interface EventRow {
  kind: "comment" | "dm" | "system" | "auth";
  status: EventStatus;
  ig_user?: string | null;
  username?: string | null;
  comment_id?: string | null;
  rule_id?: number | null;
  keyword?: string | null;
  text?: string | null;
  error?: string | null;
}

export async function logEvent(env: Env, e: EventRow): Promise<void> {
  await env.DB.prepare("INSERT INTO events (ts, kind, status, ig_user, username, comment_id, rule_id, keyword, text, error) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .bind(now(), e.kind, e.status, e.ig_user ?? null, e.username ?? null, e.comment_id ?? null, e.rule_id ?? null, e.keyword ?? null, e.text?.slice(0, 1000) ?? null, e.error ?? null)
    .run();
}

/** True the first time a key is seen (Meta retries webhooks; one comment or message must act once). */
export async function firstTime(env: Env, key: string): Promise<boolean> {
  const r = await env.DB.prepare("INSERT OR IGNORE INTO processed (key, ts) VALUES (?, ?)").bind(key, now()).run();
  return (r.meta.changes ?? 0) > 0;
}

export async function recentEvents(env: Env, limit: number, kind?: string) {
  const q = kind ? env.DB.prepare("SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?").bind(kind, limit) : env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").bind(limit);
  return (await q.all()).results;
}

/** Housekeeping the cron does: old dedupe keys, send counters and finished outbox rows. */
export async function prune(env: Env): Promise<void> {
  const week = now() - 7 * 86_400_000;
  await env.DB.batch([
    env.DB.prepare("DELETE FROM processed WHERE ts < ?").bind(week),
    env.DB.prepare("DELETE FROM sends WHERE ts < ?").bind(now() - 86_400_000),
    env.DB.prepare("DELETE FROM outbox WHERE status != 'pending' AND ts < ?").bind(week),
    env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(now() - 30 * 86_400_000),
  ]);
}
