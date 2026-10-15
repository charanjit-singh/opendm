// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Replays the real flow on a made-up conversation. Nothing is sent and nothing is stored.
import { getAccount } from "../db/accounts";
import { listRules } from "../db/rules";
import type { DryRunResult, Platform, TranscriptLine } from "../types/api";
import type { Env } from "../types/env";
import {
  advance,
  type ConvState,
  DEFAULT_PUBLIC_REPLIES,
  flowFor,
  type Outcome,
  type Picker,
  start,
  timeoutFallback,
  type Vars,
} from "./flow";
import { pickRule } from "./matching";
import { labelOf, pickPublicReply } from "./variants";

export interface DryRunInput {
  comment: string;
  platform?: Platform;
  /** Preview this wording (1-based) of every message that has variants; default: cycle from the first. */
  variant?: number;
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
  const platform = input.platform ?? "instagram";
  const hit = pickRule(await listRules(env), input.comment, input.mediaId, platform);
  if (!hit) {
    const text = input.comment
      ? "No enabled rule matches this comment, so nothing would be sent."
      : "Type a comment first.";
    return { matched: false, transcript: [{ from: "system", text }] };
  }
  const { rule, match } = hit;
  const account = await getAccount(env, platform);
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

  // Cycle in memory so a dry run shows the variants without touching the real round-robin counters.
  const used = new Map<string, number>();
  const pick: Picker = (key, count) => {
    if (input.variant) return (input.variant - 1) % count;
    const n = used.get(key) ?? 0;
    used.set(key, n + 1);
    return n % count;
  };
  const say = (outcome: Outcome, transcript: TranscriptLine[]) => {
    for (const [i, text] of outcome.messages.entries()) {
      const variant = labelOf(outcome.variants[i]);
      transcript.push({ from: "bot", text, note: variant ? `${outcome.note} (${variant})` : outcome.note });
    }
  };

  const flow = flowFor(rule, platform);
  const opening = start(flow, vars, pick);
  const publicReply = pickPublicReply(rule.public_replies.length ? rule.public_replies : DEFAULT_PUBLIC_REPLIES, pick);
  if (publicReply) {
    const note = publicReply.variant ? `public comment reply (${publicReply.variant})` : "public comment reply";
    transcript.push({ from: "public", text: publicReply.text, note });
  }
  say(opening, transcript);

  let state: ConvState = opening.state;
  const clock = Date.now();
  for (const reply of input.replies.slice(0, MAX_REPLIES)) {
    transcript.push({ from: "user", text: reply });
    const outcome = await advance(state, reply, flow, vars, {
      checkFollow: async () => following,
      now: clock,
      pick,
    });
    say(outcome, transcript);
    if (!outcome.messages.length) transcript.push({ from: "system", text: outcome.note });
    state = outcome.state;
  }
  if (input.waitMinutes > 0) {
    const outcome = timeoutFallback(state, flow, vars, clock + input.waitMinutes * 60_000, pick);
    transcript.push({
      from: "system",
      text: outcome
        ? `${input.waitMinutes} minutes pass with no reply...`
        : `${input.waitMinutes} minutes pass: nothing due yet`,
    });
    if (outcome) say(outcome, transcript);
    if (outcome) state = outcome.state;
  }
  return { matched: true, rule: { id: rule.id, name: rule.name }, finalStep: state.step, transcript };
}
