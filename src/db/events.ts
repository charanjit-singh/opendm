// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { EventKind, EventRow, EventStatus } from "../types/api";
import type { Env } from "../types/env";

export type { EventRow };

export interface EventInput {
  kind: EventKind;
  status: EventStatus;
  ig_user?: string | null;
  username?: string | null;
  comment_id?: string | null;
  rule_id?: number | null;
  keyword?: string | null;
  text?: string | null;
  error?: string | null;
}

const MAX_TEXT = 1000;

export async function logEvent(env: Env, e: EventInput): Promise<void> {
  await env.DB
    .prepare(
      "INSERT INTO events (ts, kind, status, ig_user, username, comment_id, rule_id, keyword, text, error) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
    .bind(
      Date.now(),
      e.kind,
      e.status,
      e.ig_user ?? null,
      e.username ?? null,
      e.comment_id ?? null,
      e.rule_id ?? null,
      e.keyword ?? null,
      e.text?.slice(0, MAX_TEXT) ?? null,
      e.error ?? null,
    )
    .run();
}

export async function recentEvents(env: Env, limit: number, kind?: string): Promise<EventRow[]> {
  const query = kind
    ? env.DB.prepare("SELECT * FROM events WHERE kind = ? ORDER BY id DESC LIMIT ?").bind(kind, limit)
    : env.DB.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").bind(limit);
  return (await query.all<EventRow>()).results;
}

/** Failed admin logins from one address since `sinceMs` (drives the login lockout). */
export async function countFailedLogins(env: Env, ip: string, sinceMs: number): Promise<number> {
  const row = await env.DB
    .prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'auth' AND status = 'error' AND ig_user = ? AND ts > ?")
    .bind(ip, sinceMs)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** The keyword that started the conversation for a comment, read back from the log. */
export async function keywordForComment(env: Env, commentId: string): Promise<string | null> {
  const row = await env.DB
    .prepare("SELECT keyword FROM events WHERE comment_id = ? AND keyword IS NOT NULL ORDER BY id LIMIT 1")
    .bind(commentId)
    .first<{ keyword: string }>();
  return row?.keyword ?? null;
}

/** True the first time a key is seen. Meta retries webhooks; each comment or message must act once. */
export async function markProcessed(env: Env, key: string): Promise<boolean> {
  const result = await env.DB.prepare("INSERT OR IGNORE INTO processed (key, ts) VALUES (?, ?)").bind(key, Date.now()).run();
  return (result.meta.changes ?? 0) > 0;
}

const DAY_MS = 86_400_000;

/** Housekeeping for the cron: old dedupe keys, send counters, finished outbox rows and old log lines. */
export async function pruneOldRows(env: Env): Promise<void> {
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("DELETE FROM processed WHERE ts < ?").bind(now - 7 * DAY_MS),
    env.DB.prepare("DELETE FROM sends WHERE ts < ?").bind(now - DAY_MS),
    env.DB.prepare("DELETE FROM outbox WHERE status != 'pending' AND ts < ?").bind(now - 7 * DAY_MS),
    env.DB.prepare("DELETE FROM events WHERE ts < ?").bind(now - 30 * DAY_MS),
  ]);
}
