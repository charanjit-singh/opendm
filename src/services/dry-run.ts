// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Replays the real flow on a made-up conversation. Nothing is sent and nothing is stored.
import { getAccount } from "../db/account";
import { listRules } from "../db/rules";
import type { DryRunResult, TranscriptLine } from "../types/api";
import type { Env } from "../types/env";
import {
  advance,
  type ConvState,
  DEFAULT_PUBLIC_REPLIES,
  pickReply,
  start,
  timeoutFallback,
  type Vars,
} from "./flow";
import { pickRule } from "./matching";

export interface DryRunInput {
  comment: string;
  mediaId?: string;
  name?: string;
  /** What the person types back, in order. */
  replies: string[];
  /** What the follow check would say. */
  following: "yes" | "no" | "unknown";
  /** Minutes that pass with no reply at the end (triggers the follow timeout). */
  waitMinutes: number;
}

const MAX_REPLIES = 12;

export async function dryRun(env: Env, input: DryRunInput): Promise<DryRunResult> {
  const hit = pickRule(await listRules(env), input.comment, input.mediaId);
  if (!hit) {
    const text = input.comment ? "No enabled rule matches this comment, so nothing would be sent." : "Type a comment first.";
    return { matched: false, transcript: [{ from: "system", text }] };
  }
  const { rule, match } = hit;
  const account = await getAccount(env);
  const vars: Vars = {
    name: input.name || undefined,
    username: "sample_user",
    keyword: match.keyword,
    link: rule.link,
    account: account?.username ?? "youraccount",
  };
  const following = { yes: true, no: false, unknown: null }[input.following];
  const matchNote = match.fuzzy ? `typo match (${match.fuzzy})` : `matched "${match.keyword}" in rule "${rule.name}"`;
  const transcript: TranscriptLine[] = [{ from: "user", text: input.comment, note: matchNote }];

  const opening = start(rule.flow, vars);
  const publicReply = pickReply(rule.public_replies.length ? rule.public_replies : DEFAULT_PUBLIC_REPLIES, null, () => 0);
  if (publicReply) transcript.push({ from: "public", text: publicReply, note: "public comment reply" });
  for (const text of opening.messages) transcript.push({ from: "bot", text, note: opening.note });

  let state: ConvState = opening.state;
  const clock = Date.now();
  for (const reply of input.replies.slice(0, MAX_REPLIES)) {
    transcript.push({ from: "user", text: reply });
    const outcome = await advance(state, reply, rule.flow, vars, { checkFollow: async () => following, now: clock });
    for (const text of outcome.messages) transcript.push({ from: "bot", text, note: outcome.note });
    if (!outcome.messages.length) transcript.push({ from: "system", text: outcome.note });
    state = outcome.state;
  }
  if (input.waitMinutes > 0) {
    const outcome = timeoutFallback(state, rule.flow, vars, clock + input.waitMinutes * 60_000);
    transcript.push({
      from: "system",
      text: outcome ? `${input.waitMinutes} minutes pass with no reply...` : `${input.waitMinutes} minutes pass: nothing due yet`,
    });
    for (const text of outcome?.messages ?? []) transcript.push({ from: "bot", text, note: outcome?.note });
    if (outcome) state = outcome.state;
  }
  return { matched: true, rule: { id: rule.id, name: rule.name }, finalStep: state.step, transcript };
}
