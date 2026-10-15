// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Turns webhook events into actions: a keyword comment starts a conversation (private reply + public reply),
// a DM moves it one step along the rule's flow, and a keyword DM can start one too. Works for Instagram and Facebook.

import type { Account } from "../db/accounts";
import { getAccount } from "../db/accounts";
import { type Conversation, findActiveConversation, toState, upsertConversation } from "../db/conversations";
import { keywordForComment, logEvent, markProcessed } from "../db/events";
import { getRule, listRules, type Rule } from "../db/rules";
import { isEnabled } from "../db/settings";
import type { Platform } from "../types/api";
import type { Env } from "../types/env";
import type { IgComment, IgMessage, InboundComment, WebhookEntry, WebhookPayload } from "../types/instagram";
import { clientFor } from "./account-client";
import { buildVars } from "./conversation-context";
import { advance, DEFAULT_PUBLIC_REPLIES, type Flow, flowFor, type Outcome, start, startFromDm } from "./flow";
import { pickRule } from "./matching";
import { dispatch, type LogContext } from "./send-queue";
import { createPicker, labelOf, pickPublicReply } from "./variants";

const PLATFORM_OF_OBJECT: Record<string, Platform> = { instagram: "instagram", page: "facebook" };

export async function handleWebhook(env: Env, payload: WebhookPayload): Promise<void> {
  const platform = PLATFORM_OF_OBJECT[payload.object ?? ""];
  if (!platform) return;
  for (const entry of payload.entry ?? []) {
    for (const comment of commentsOf(platform, entry)) await onComment(env, platform, entry.id, comment);
    for (const message of entry.messaging ?? []) await onMessage(env, platform, entry.id, message);
  }
}

/** Both platforms' comment events in one shape. */
function commentsOf(platform: Platform, entry: WebhookEntry): InboundComment[] {
  const out: InboundComment[] = [];
  for (const change of entry.changes ?? []) {
    const v = change.value;
    if (!v) continue;
    if (platform === "instagram" && change.field === "comments" && v.id && v.text) {
      out.push({
        id: v.id,
        text: v.text,
        fromId: v.from?.id,
        fromName: v.from?.username,
        mediaId: v.media?.id,
        isReply: !!v.parent_id,
      });
    }
    // Facebook feed: a top-level comment has parent_id = post_id; anything else is a reply in a thread.
    if (
      platform === "facebook" &&
      change.field === "feed" &&
      v.item === "comment" &&
      v.verb === "add" &&
      v.comment_id &&
      v.message
    ) {
      out.push({
        id: v.comment_id,
        text: v.message,
        fromId: v.from?.id,
        fromName: v.from?.name,
        mediaId: v.post_id,
        isReply: !!v.parent_id && v.parent_id !== v.post_id,
      });
    }
  }
  return out;
}

/** A flow that sends the link in the very first message (for commenters whose id we can't see). */
const linkOnly = (flow: Flow): Flow => ({ ...flow, opener: false, requireFollow: false, askEmail: "off" });

async function onComment(
  env: Env,
  platform: Platform,
  accountId: string | undefined,
  c: InboundComment,
): Promise<void> {
  const base = {
    kind: "comment" as const,
    ig_user: c.fromId ?? null,
    username: c.fromName ?? null,
    comment_id: c.id,
    text: c.text,
    platform,
  };
  // The account's own replies and replies inside a thread are never triggers (they would loop).
  if (c.fromId && c.fromId === accountId) return;
  if (c.isReply) return;
  if (!(await markProcessed(env, `c:${c.id}`))) return;
  if (!(await isEnabled(env))) {
    await logEvent(env, { ...base, status: "skipped", error: "automation is switched off" });
    return;
  }
  const hit = pickRule(await listRules(env), c.text, c.mediaId, platform);
  if (!hit) {
    await logEvent(env, { ...base, status: "skipped", error: "no keyword matched" });
    return;
  }
  const { rule, match } = hit;
  const account = await getAccount(env, platform);
  if (!account) {
    await logEvent(env, {
      ...base,
      status: "error",
      rule_id: rule.id,
      keyword: match.keyword,
      error: `no ${platform} account connected`,
    });
    return;
  }
  const picker = await createPicker(env, rule.id, rule.flow.rotation);
  const ruleFlow = flowFor(rule, platform);
  const flow = c.fromId ? ruleFlow : linkOnly(ruleFlow);
  const outcome = start(flow, buildVars(rule, account, { username: c.fromName }, match.keyword), picker.pick);
  const ctx: LogContext = {
    username: c.fromName,
    keyword: match.keyword,
    rule_id: rule.id,
    ig_user: c.fromId,
    variant: labelOf(outcome.variants[0]),
  };
  const sent = await dispatch(env, {
    platform,
    kind: "private_reply",
    commentId: c.id,
    text: outcome.messages[0],
    ctx,
  });
  if (sent !== "error") {
    if (c.fromId) {
      await upsertConversation(
        env,
        { ig_user: c.fromId, rule_id: rule.id, platform, username: c.fromName, comment_id: c.id },
        outcome.state,
      );
    }
    const reply = pickPublicReply(
      rule.public_replies.length ? rule.public_replies : DEFAULT_PUBLIC_REPLIES,
      picker.pick,
    );
    if (reply)
      await dispatch(env, {
        platform,
        kind: "public_reply",
        commentId: c.id,
        text: reply.text,
        ctx: { ...ctx, variant: reply.variant },
      });
  }
  await picker.commit();
}

async function onMessage(env: Env, platform: Platform, accountId: string | undefined, m: IgMessage): Promise<void> {
  const sender = m.sender?.id;
  const text = m.message?.text;
  if (!sender || !text || m.message?.is_echo || sender === accountId) return;
  if (m.message?.mid && !(await markProcessed(env, `m:${m.message.mid}`))) return;

  const conversation = await findActiveConversation(env, sender);
  if (!conversation) return onKeywordDm(env, platform, sender, text);

  const account = await getAccount(env, conversation.platform);
  const rule = await getRule(env, conversation.rule_id);
  if (!account || !rule) return;
  if (!(await isEnabled(env))) {
    await logEvent(env, {
      kind: "dm",
      status: "skipped",
      platform,
      ig_user: sender,
      text,
      error: "automation is switched off",
    });
    return;
  }
  const keyword = (await keywordForComment(env, conversation.comment_id ?? "")) ?? rule.keywords[0];
  const lookup = profileLookup(env, account, sender);
  const vars = buildVars(rule, account, { name: (await lookup()).name, username: conversation.username }, keyword);
  const picker = await createPicker(env, rule.id, rule.flow.rotation);
  const outcome = await advance(toState(conversation), text, flowFor(rule, conversation.platform), vars, {
    checkFollow: async () => (await lookup()).following,
    now: Date.now(),
    pick: picker.pick,
  });
  const ctx: LogContext = { username: conversation.username, keyword, rule_id: rule.id, ig_user: sender };
  await logEvent(env, { kind: "dm", status: "info", platform, ...ctx, text: `[user] ${text}`, error: outcome.note });
  await sendOutcome(env, conversation, outcome, ctx);
  await picker.commit();
}

/** The profile lookup gives the first name and (Instagram only, when Meta allows it) the follow status. Fetched at most once. */
function profileLookup(env: Env, account: Account, userId: string) {
  let cached: Awaited<ReturnType<ReturnType<typeof clientFor>["profile"]>> | undefined;
  return async () => {
    cached ??= await clientFor(env, account).profile(userId);
    return cached;
  };
}

/** A DM with no conversation behind it: start one if a rule listens for keyword DMs on this platform. */
async function onKeywordDm(env: Env, platform: Platform, sender: string, text: string): Promise<void> {
  const base = { kind: "dm" as const, platform, ig_user: sender, text };
  const hit = pickRule(
    (await listRules(env)).filter((r) => r.dm_trigger),
    text,
    undefined,
    platform,
  );
  if (!hit || !(await isEnabled(env))) {
    await logEvent(env, { ...base, status: "info", error: "message without an active conversation, ignored" });
    return;
  }
  const { rule, match } = hit;
  const account = await getAccount(env, platform);
  if (!account) return;
  const lookup = profileLookup(env, account, sender);
  const vars = buildVars(rule, account, { name: (await lookup()).name }, match.keyword);
  const picker = await createPicker(env, rule.id, rule.flow.rotation);
  const outcome = await startFromDm(flowFor(rule, platform), text, vars, {
    checkFollow: async () => (await lookup()).following,
    now: Date.now(),
    pick: picker.pick,
  });
  const ctx: LogContext = { keyword: match.keyword, rule_id: rule.id, ig_user: sender };
  await logEvent(env, {
    ...base,
    status: "info",
    rule_id: rule.id,
    keyword: match.keyword,
    error: `keyword DM: ${outcome.note}`,
  });
  const conversation: Conversation = {
    id: 0,
    ig_user: sender,
    rule_id: rule.id,
    platform,
    username: null,
    comment_id: null,
    ...outcome.state,
  };
  await sendOutcome(env, conversation, outcome, ctx);
  await picker.commit();
}

/** Sends an outcome's messages in order (stopping at the first failure) and saves the new state. */
export async function sendOutcome(
  env: Env,
  conversation: Conversation,
  outcome: Outcome,
  ctx: LogContext,
): Promise<void> {
  for (const [i, text] of outcome.messages.entries()) {
    const job = {
      platform: conversation.platform,
      kind: "dm" as const,
      userId: conversation.ig_user,
      text,
      ctx: { ...ctx, variant: labelOf(outcome.variants[i]) },
    };
    if ((await dispatch(env, job)) === "error") break;
  }
  await upsertConversation(
    env,
    { ig_user: conversation.ig_user, rule_id: conversation.rule_id, platform: conversation.platform },
    outcome.state,
  );
}

export type { IgComment, Rule };
