// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Turns webhook events into actions: a keyword comment starts a conversation (private reply + public reply),
// a DM moves it one step along the rule's flow.
import { getAccount } from "../db/account";
import { type Conversation, findActiveConversation, toState, upsertConversation } from "../db/conversations";
import { keywordForComment, logEvent, markProcessed } from "../db/events";
import { getRule, listRules } from "../db/rules";
import { getSetting, isEnabled, SETTING, setSetting } from "../db/settings";
import type { Env } from "../types/env";
import type { IgComment, IgMessage, WebhookPayload } from "../types/instagram";
import { buildVars } from "./conversation-context";
import { advance, DEFAULT_PUBLIC_REPLIES, type Outcome, pickReply, start } from "./flow";
import { graphClientFor } from "./graph";
import { pickRule } from "./matching";
import { dispatch, type LogContext } from "./send-queue";

export async function handleWebhook(env: Env, payload: WebhookPayload): Promise<void> {
  if (payload.object !== "instagram") return;
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      if (change.field === "comments" && change.value) await onComment(env, entry.id, change.value);
    }
    for (const message of entry.messaging ?? []) await onMessage(env, entry.id, message);
  }
}

async function onComment(env: Env, accountId: string | undefined, comment: IgComment): Promise<void> {
  const base = {
    kind: "comment" as const,
    ig_user: comment.from?.id ?? null,
    username: comment.from?.username ?? null,
    comment_id: comment.id,
    text: comment.text ?? "",
  };
  if (!comment.id || !comment.text) return;
  // The account's own replies and replies inside a thread are never triggers (they would loop).
  if (comment.from?.id && comment.from.id === accountId) return;
  if (comment.parent_id) return;
  if (!(await markProcessed(env, `c:${comment.id}`))) return;
  if (!(await isEnabled(env))) {
    await logEvent(env, { ...base, status: "skipped", error: "automation is switched off" });
    return;
  }
  const hit = pickRule(await listRules(env), comment.text, comment.media?.id);
  if (!hit) {
    await logEvent(env, { ...base, status: "skipped", error: "no keyword matched" });
    return;
  }
  const { rule, match } = hit;
  const account = await getAccount(env);
  if (!account) {
    await logEvent(env, {
      ...base,
      status: "error",
      rule_id: rule.id,
      keyword: match.keyword,
      error: "no Instagram account connected",
    });
    return;
  }
  const ctx: LogContext = {
    username: comment.from?.username,
    keyword: match.keyword,
    rule_id: rule.id,
    ig_user: comment.from?.id,
  };
  const outcome = start(rule.flow, buildVars(rule, account, { username: comment.from?.username }, match.keyword));
  const sent = await dispatch(env, { kind: "private_reply", commentId: comment.id, text: outcome.messages[0], ctx });
  if (sent === "error") return;
  if (comment.from?.id) {
    await upsertConversation(
      env,
      { ig_user: comment.from.id, rule_id: rule.id, username: comment.from.username, comment_id: comment.id },
      outcome.state,
    );
  }
  await postPublicReply(env, comment.id, rule.public_replies, ctx);
}

async function postPublicReply(env: Env, commentId: string, lines: string[], ctx: LogContext): Promise<void> {
  const last = await getSetting(env, SETTING.lastPublicReply);
  const reply = pickReply(lines.length ? lines : DEFAULT_PUBLIC_REPLIES, last);
  if (!reply) return;
  await setSetting(env, SETTING.lastPublicReply, reply);
  await dispatch(env, { kind: "public_reply", commentId, text: reply, ctx });
}

async function onMessage(env: Env, accountId: string | undefined, message: IgMessage): Promise<void> {
  const sender = message.sender?.id;
  const text = message.message?.text;
  if (!sender || !text || message.message?.is_echo || sender === accountId) return;
  if (message.message?.mid && !(await markProcessed(env, `m:${message.message.mid}`))) return;

  const conversation = await findActiveConversation(env, sender);
  if (!conversation) {
    await logEvent(env, {
      kind: "dm",
      status: "info",
      ig_user: sender,
      text,
      error: "message without an active conversation, ignored",
    });
    return;
  }
  const account = await getAccount(env);
  const rule = await getRule(env, conversation.rule_id);
  if (!account || !rule) return;
  if (!(await isEnabled(env))) {
    await logEvent(env, { kind: "dm", status: "skipped", ig_user: sender, text, error: "automation is switched off" });
    return;
  }

  const keyword = (await keywordForComment(env, conversation.comment_id ?? "")) ?? rule.keywords[0];
  const vars = buildVars(rule, account, { username: conversation.username }, keyword);

  // The profile lookup gives the first name and (when Meta allows it) the follow status. Fetched at most once.
  const graph = graphClientFor(env, account);
  let profile: { name?: string; following: boolean | null } | undefined;
  const lookupProfile = async () => {
    if (!profile) {
      const result = await graph.profile(sender);
      profile = result.ok
        ? {
            name: result.data.name?.split(" ")[0],
            following:
              typeof result.data.is_user_follow_business === "boolean" ? result.data.is_user_follow_business : null,
          }
        : { following: null };
    }
    return profile;
  };
  vars.name = (await lookupProfile()).name;

  const outcome = await advance(toState(conversation), text, rule.flow, vars, {
    checkFollow: async () => (await lookupProfile()).following,
    now: Date.now(),
  });
  const ctx: LogContext = { username: conversation.username, keyword, rule_id: rule.id, ig_user: sender };
  await logEvent(env, {
    kind: "dm",
    status: "info",
    ig_user: sender,
    username: conversation.username,
    rule_id: rule.id,
    keyword,
    text: `[user] ${text}`,
    error: outcome.note,
  });
  await sendOutcome(env, conversation, outcome, ctx);
}

/** Sends an outcome's messages in order (stopping at the first failure) and saves the new state. */
export async function sendOutcome(
  env: Env,
  conversation: Conversation,
  outcome: Outcome,
  ctx: LogContext,
): Promise<void> {
  for (const text of outcome.messages) {
    if ((await dispatch(env, { kind: "dm", userId: conversation.ig_user, text, ctx })) === "error") break;
  }
  await upsertConversation(env, { ig_user: conversation.ig_user, rule_id: conversation.rule_id }, outcome.state);
}
