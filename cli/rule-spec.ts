// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The friendly description of a rule that Claude (or a CLI user) provides, and how it maps onto the API payload.
import { z } from "zod";
import type { Rule } from "../src/types/api.ts";
import type { RulePayload } from "./client.ts";

/** Every field is optional here; create requires keywords on top (see createRuleSchema). */
export const ruleSpecShape = {
  name: z.string().optional().describe("A label for the rule, e.g. 'Free guide'."),
  keywords: z
    .array(z.string())
    .optional()
    .describe("Words or phrases that trigger the rule, e.g. ['AUTOMATION']. Case and small typos are ignored."),
  link: z.string().optional().describe("The URL to send at the end of the conversation ({link} in messages)."),
  mediaId: z
    .string()
    .nullable()
    .optional()
    .describe("Only fire on this post (Instagram media id). Omit or null for all posts."),
  enabled: z.boolean().optional().describe("Whether the rule is active."),
  allowTypos: z.boolean().optional().describe("Match keywords with one small typo (default true)."),
  publicReplies: z.array(z.string()).optional().describe("Public comment replies, rotated. Empty uses the defaults."),
  openerFirst: z
    .boolean()
    .optional()
    .describe("Private reply is a short 'want it?' and the link follows after the person replies (default true)."),
  openerText: z.string().optional().describe("The opener message. Placeholders: {name} {keyword} {link} {account}."),
  requireFollow: z
    .boolean()
    .optional()
    .describe("Ask them to follow the account before sending the link (default true)."),
  followText: z.string().optional().describe("The message asking them to follow."),
  followTimeoutMinutes: z
    .number()
    .int()
    .min(2)
    .max(600)
    .optional()
    .describe("If they don't answer the follow question in this many minutes, send the link anyway."),
  followGiveUp: z
    .enum(["send", "stop"])
    .optional()
    .describe("When they still aren't following after the retries: send the link anyway, or stop."),
  askEmail: z.enum(["off", "optional", "required"]).optional().describe("Collect an email before the link."),
  emailText: z.string().optional().describe("The message asking for an email."),
  finalMessage: z.string().optional().describe("The last message, containing {link}."),
};

export const ruleSpecSchema = z.object(ruleSpecShape);
export type RuleSpec = z.infer<typeof ruleSpecSchema>;

export const createRuleSchema = ruleSpecSchema.extend({ keywords: z.array(z.string()).min(1, "keywords is required") });

/** Friendly spec -> API payload. Only fields that were given are included. */
export function specToPayload(spec: RuleSpec): Partial<RulePayload> {
  const flow: Record<string, unknown> = {};
  const set = (key: string, value: unknown) => {
    if (value !== undefined) flow[key] = value;
  };
  set("opener", spec.openerFirst);
  set("openerText", spec.openerText);
  set("requireFollow", spec.requireFollow);
  set("followText", spec.followText);
  set("followTimeoutMin", spec.followTimeoutMinutes);
  set("followGiveUp", spec.followGiveUp);
  set("askEmail", spec.askEmail);
  set("emailText", spec.emailText);
  set("deliverText", spec.finalMessage);

  const payload: Partial<RulePayload> = { flow };
  if (spec.name !== undefined) payload.name = spec.name;
  if (spec.keywords !== undefined) payload.keywords = spec.keywords;
  if (spec.link !== undefined) payload.link = spec.link;
  if (spec.mediaId !== undefined) payload.media_id = spec.mediaId;
  if (spec.enabled !== undefined) payload.enabled = spec.enabled;
  if (spec.allowTypos !== undefined) payload.fuzzy = spec.allowTypos;
  if (spec.publicReplies !== undefined) payload.public_replies = spec.publicReplies;
  return payload;
}

/** The stored rule as an API payload, so an update can overlay changes on it (the API replaces whole rules). */
export function ruleToPayload(rule: Rule): RulePayload {
  return {
    name: rule.name,
    keywords: rule.keywords,
    link: rule.link,
    media_id: rule.media_id,
    enabled: rule.enabled,
    fuzzy: rule.fuzzy,
    public_replies: rule.public_replies,
    flow: rule.flow_raw,
  };
}

export function mergePayload(base: RulePayload, changes: Partial<RulePayload>): RulePayload {
  return { ...base, ...changes, flow: { ...base.flow, ...changes.flow } };
}
