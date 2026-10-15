// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { ConvState, Step } from "../services/flow";
import type { Platform } from "../types/api";
import type { Env } from "../types/env";

export interface Conversation extends ConvState {
  id: number;
  ig_user: string;
  rule_id: number;
  platform: Platform;
  username: string | null;
  comment_id: string | null;
}

interface ConversationRow {
  id: number;
  ig_user: string;
  rule_id: number;
  step: string;
  tries: number;
  email: string | null;
  username: string | null;
  comment_id: string | null;
  follow_asked_at: number | null;
  platform: Platform;
}

const toConversation = (r: ConversationRow): Conversation => ({
  id: r.id,
  ig_user: r.ig_user,
  rule_id: r.rule_id,
  platform: r.platform,
  step: r.step as Step,
  tries: r.tries,
  email: r.email,
  followAskedAt: r.follow_asked_at,
  username: r.username,
  comment_id: r.comment_id,
});

export const toState = (c: Conversation): ConvState => ({
  step: c.step,
  tries: c.tries,
  email: c.email,
  followAskedAt: c.followAskedAt,
});

export interface ConversationKey {
  ig_user: string;
  rule_id: number;
  platform?: Platform;
  username?: string | null;
  comment_id?: string | null;
}

/** One conversation per person per rule: a new comment restarts it. */
export async function upsertConversation(env: Env, key: ConversationKey, state: ConvState): Promise<void> {
  const now = Date.now();
  await env.DB.prepare(
    `INSERT INTO conversations (ig_user, rule_id, step, tries, email, username, comment_id, follow_asked_at, started, updated, platform)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(ig_user, rule_id) DO UPDATE SET
         step = excluded.step,
         tries = excluded.tries,
         email = COALESCE(excluded.email, conversations.email),
         username = COALESCE(excluded.username, conversations.username),
         comment_id = COALESCE(excluded.comment_id, conversations.comment_id),
         follow_asked_at = excluded.follow_asked_at,
         platform = excluded.platform,
         updated = excluded.updated`,
  )
    .bind(
      key.ig_user,
      key.rule_id,
      state.step,
      state.tries,
      state.email,
      key.username ?? null,
      key.comment_id ?? null,
      state.followAskedAt,
      now,
      now,
      key.platform ?? "instagram",
    )
    .run();
}

/** The conversation a DM from this person belongs to: their most recently updated unfinished one. */
export async function findActiveConversation(env: Env, igUser: string): Promise<Conversation | null> {
  const row = await env.DB.prepare(
    "SELECT * FROM conversations WHERE ig_user = ? AND step IN ('opened','awaiting_follow','awaiting_email') ORDER BY updated DESC LIMIT 1",
  )
    .bind(igUser)
    .first<ConversationRow>();
  return row ? toConversation(row) : null;
}

/** People still on the follow question since `olderThan`. */
export async function findFollowWaiting(env: Env, olderThan: number): Promise<Conversation[]> {
  const { results } = await env.DB.prepare(
    "SELECT * FROM conversations WHERE step = 'awaiting_follow' AND follow_asked_at IS NOT NULL AND follow_asked_at <= ?",
  )
    .bind(olderThan)
    .all<ConversationRow>();
  return results.map(toConversation);
}

export interface ConversationSummary {
  id: number;
  ig_user: string;
  username: string | null;
  platform: Platform;
  rule_id: number;
  rule_name: string | null;
  step: Step;
  email: string | null;
  started: number;
  updated: number;
}

/** Newest first. `onlyWithEmail` turns the list into captured leads. */
export async function listConversations(
  env: Env,
  opts: { step?: string; onlyWithEmail?: boolean; limit?: number } = {},
): Promise<ConversationSummary[]> {
  const where: string[] = [];
  const binds: (string | number)[] = [];
  if (opts.step) {
    where.push("c.step = ?");
    binds.push(opts.step);
  }
  if (opts.onlyWithEmail) where.push("c.email IS NOT NULL");
  const sql = `SELECT c.id, c.ig_user, c.username, c.platform, c.rule_id, r.name AS rule_name, c.step, c.email, c.started, c.updated
    FROM conversations c LEFT JOIN rules r ON r.id = c.rule_id
    ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY c.updated DESC LIMIT ?`;
  const { results } = await env.DB.prepare(sql)
    .bind(...binds, Math.min(500, opts.limit ?? 100))
    .all<ConversationSummary>();
  return results;
}
