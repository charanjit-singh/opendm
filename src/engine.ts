// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Turns webhook events into actions: comment -> private reply (+ public reply), DM -> next flow step, cron -> follow timeouts.
import { advance, DEFAULT_PUBLIC_REPLIES, pickReply, start, timeoutFallback, type ConvState, type Outcome, type Vars } from "./flow";
import { pickRule } from "./match";
import { dispatch, type LogCtx } from "./queue";
import { activeConversation, firstTime, followWaiting, getAccount, getRule, getSetting, graphFor, isEnabled, listRules, logEvent, now, setSetting, upsertConversation, type Account, type Conversation, type Rule } from "./store";
import type { Env } from "./types";

export interface IgComment {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string };
  parent_id?: string;
}

export interface IgMessage {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
}

export interface WebhookPayload {
  object?: string;
  entry?: { id?: string; changes?: { field?: string; value?: IgComment }[]; messaging?: IgMessage[] }[];
}

const link = (rule: Rule) => rule.link;

const varsFor = (rule: Rule, acct: Account, who: { name?: string; username?: string | null }, keyword: string): Vars => ({
  name: who.name,
  username: who.username ?? undefined,
  keyword,
  link: link(rule),
  account: acct.username ?? undefined,
});

export async function handleWebhook(env: Env, payload: WebhookPayload): Promise<void> {
  if (payload.object !== "instagram") return;
  for (const entry of payload.entry ?? []) {
    for (const ch of entry.changes ?? []) if (ch.field === "comments" && ch.value) await onComment(env, entry.id, ch.value);
    for (const m of entry.messaging ?? []) await onMessage(env, entry.id, m);
  }
}

async function onComment(env: Env, accountId: string | undefined, c: IgComment): Promise<void> {
  const base = { kind: "comment" as const, ig_user: c.from?.id ?? null, username: c.from?.username ?? null, comment_id: c.id, text: c.text ?? "" };
  if (!c.id || !c.text) return;
  // Our own replies and replies in threads are never triggers (the account replying publicly would loop).
  if (c.from?.id && c.from.id === accountId) return;
  if (c.parent_id) return;
  if (!(await firstTime(env, `c:${c.id}`))) return;
  if (!(await isEnabled(env))) return void (await logEvent(env, { ...base, status: "skipped", error: "automation is switched off" }));
  const hit = pickRule(await listRules(env), c.text, c.media?.id);
  if (!hit) return void (await logEvent(env, { ...base, status: "skipped", error: "no keyword matched" }));
  const { rule, match } = hit;
  const acct = await getAccount(env);
  if (!acct) return void (await logEvent(env, { ...base, status: "error", rule_id: rule.id, keyword: match.keyword, error: "no Instagram account connected" }));
  const ctx: LogCtx = { username: c.from?.username, keyword: match.keyword, rule_id: rule.id, ig_user: c.from?.id };
  const outcome = start(rule.flow, varsFor(rule, acct, { username: c.from?.username }, match.keyword));
  const sent = await dispatch(env, { kind: "private_reply", commentId: c.id, text: outcome.messages[0], ctx });
  if (sent !== "error" && c.from?.id) await upsertConversation(env, { ig_user: c.from.id, rule_id: rule.id, username: c.from.username, comment_id: c.id }, outcome.state);
  if (sent === "error") return;
  const last = await getSetting(env, "last_public_reply");
  const reply = pickReply(rule.public_replies.length ? rule.public_replies : DEFAULT_PUBLIC_REPLIES, last);
  if (reply) {
    await setSetting(env, "last_public_reply", reply);
    await dispatch(env, { kind: "public_reply", commentId: c.id, text: reply, ctx });
  }
}

async function onMessage(env: Env, accountId: string | undefined, m: IgMessage): Promise<void> {
  const sender = m.sender?.id;
  const text = m.message?.text;
  if (!sender || !text || m.message?.is_echo || sender === accountId) return;
  if (m.message?.mid && !(await firstTime(env, `m:${m.message.mid}`))) return;
  const conv = await activeConversation(env, sender);
  if (!conv) return void (await logEvent(env, { kind: "dm", status: "info", ig_user: sender, text, error: "message without an active conversation, ignored" }));
  const acct = await getAccount(env);
  const rule = await getRule(env, conv.rule_id);
  if (!acct || !rule) return;
  if (!(await isEnabled(env))) return void (await logEvent(env, { kind: "dm", status: "skipped", ig_user: sender, text, error: "automation is switched off" }));
  const graph = graphFor(env, acct);
  let profile: { name?: string; following: boolean | null } | undefined;
  const lookup = async () => {
    if (!profile) {
      const r = await graph.profile(sender);
      profile = r.ok ? { name: r.data.name?.split(" ")[0], following: typeof r.data.is_user_follow_business === "boolean" ? r.data.is_user_follow_business : null } : { following: null };
    }
    return profile;
  };
  const vars = varsFor(rule, acct, { name: undefined, username: conv.username }, rule.keywords[0]);
  const keyword = (await getKeywordOf(env, conv)) ?? rule.keywords[0];
  vars.keyword = keyword;
  if (rule.flow.requireFollow || rule.flow.opener) vars.name = (await lookup()).name;
  const outcome = await advance(toState(conv), text, rule.flow, vars, { checkFollow: async () => (await lookup()).following, now: now() });
  await logEvent(env, { kind: "dm", status: "info", ig_user: sender, username: conv.username, rule_id: rule.id, keyword, text: `[user] ${text}`, error: outcome.note });
  await deliverOutcome(env, conv, outcome, { username: conv.username, keyword, rule_id: rule.id, ig_user: sender });
}

const toState = (c: Conversation): ConvState => ({ step: c.step, tries: c.tries, email: c.email, followAskedAt: c.followAskedAt });

/** The keyword that triggered this conversation, from the log (the conversation row only knows the rule). */
async function getKeywordOf(env: Env, c: Conversation): Promise<string | null> {
  if (!c.comment_id) return null;
  const r = await env.DB.prepare("SELECT keyword FROM events WHERE comment_id = ? AND keyword IS NOT NULL ORDER BY id LIMIT 1").bind(c.comment_id).first<{ keyword: string }>();
  return r?.keyword ?? null;
}

async function deliverOutcome(env: Env, conv: Conversation, o: Outcome, ctx: LogCtx): Promise<void> {
  for (const text of o.messages) if ((await dispatch(env, { kind: "dm", userId: conv.ig_user, text, ctx })) === "error") break;
  await upsertConversation(env, { ig_user: conv.ig_user, rule_id: conv.rule_id }, o.state);
}

/** Cron: people who never answered the follow question get the link anyway once their rule's timeout has passed. */
export async function processFollowTimeouts(env: Env): Promise<number> {
  const waiting = await followWaiting(env, now() - 2 * 60_000);
  const acct = waiting.length ? await getAccount(env) : null;
  if (!acct) return 0;
  let n = 0;
  for (const conv of waiting) {
    const rule = await getRule(env, conv.rule_id);
    if (!rule) continue;
    const keyword = (await getKeywordOf(env, conv)) ?? rule.keywords[0];
    const o = timeoutFallback(toState(conv), rule.flow, varsFor(rule, acct, { username: conv.username }, keyword), now());
    if (!o) continue;
    await logEvent(env, { kind: "dm", status: "info", ig_user: conv.ig_user, username: conv.username, rule_id: rule.id, keyword, error: o.note });
    await deliverOutcome(env, conv, o, { username: conv.username, keyword, rule_id: rule.id, ig_user: conv.ig_user });
    n++;
  }
  return n;
}
