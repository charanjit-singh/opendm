// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { getAccount } from "../db/account";
import { findFollowWaiting, toState } from "../db/conversations";
import { keywordForComment, logEvent } from "../db/events";
import { getRule } from "../db/rules";
import type { Env } from "../types/env";
import { buildVars } from "./conversation-context";
import { timeoutFallback } from "./flow";
import { sendOutcome } from "./webhook-processor";

const MIN_AGE_MS = 2 * 60_000;

/** Cron: people who never answered the follow question get the link anyway once their rule's timeout has passed. */
export async function processFollowTimeouts(env: Env): Promise<number> {
  const waiting = await findFollowWaiting(env, Date.now() - MIN_AGE_MS);
  const account = waiting.length ? await getAccount(env) : null;
  if (!account) return 0;
  let processed = 0;
  for (const conversation of waiting) {
    const rule = await getRule(env, conversation.rule_id);
    if (!rule) continue;
    const keyword = (await keywordForComment(env, conversation.comment_id ?? "")) ?? rule.keywords[0];
    const vars = buildVars(rule, account, { username: conversation.username }, keyword);
    const outcome = timeoutFallback(toState(conversation), rule.flow, vars, Date.now());
    if (!outcome) continue;
    const ctx = { username: conversation.username, keyword, rule_id: rule.id, ig_user: conversation.ig_user };
    await logEvent(env, { kind: "dm", status: "info", ...ctx, error: outcome.note });
    await sendOutcome(env, conversation, outcome, ctx);
    processed++;
  }
  return processed;
}
