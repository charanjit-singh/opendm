// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The operations Claude (through MCP) and the CLI can perform. One definition feeds both.
import { z } from "zod";
import type { DryRunResult, EventRow, Rule } from "../src/types/api.ts";
import type { OpenDmClient } from "./client.ts";
import { createRuleSchema, mergePayload, ruleSpecShape, ruleToPayload, specToPayload } from "./rule-spec.ts";

interface ToolDefinition<Shape extends z.ZodRawShape> {
  name: string;
  description: string;
  shape: Shape;
  /** Returns plain text for the model or the terminal. */
  run: (client: OpenDmClient, args: z.infer<z.ZodObject<Shape>>) => Promise<string>;
}

/** A tool as the MCP server and the CLI see it: untyped input, validated against the shape before it runs. */
export interface Tool {
  name: string;
  description: string;
  shape: z.ZodRawShape;
  run: (client: OpenDmClient, input: unknown) => Promise<string>;
}

function defineTool<Shape extends z.ZodRawShape>(tool: ToolDefinition<Shape>): Tool {
  const schema = z.object(tool.shape);
  return {
    name: tool.name,
    description: tool.description,
    shape: tool.shape,
    run: async (client, input) => {
      const parsed = schema.safeParse(input);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new Error(`Invalid input${issue?.path.length ? ` (${issue.path.join(".")})` : ""}: ${issue?.message}`);
      }
      return tool.run(client, parsed.data);
    },
  };
}

// ---- formatting -----------------------------------------------------------------------------------------------
export function describeRule(rule: Rule): string {
  const f = rule.flow;
  const steps = [
    f.opener || f.requireFollow || f.askEmail !== "off" ? "opener" : "link straight in the private reply",
    f.requireFollow ? `follow gate (timeout ${f.followTimeoutMin} min)` : null,
    f.askEmail !== "off" ? `email (${f.askEmail})` : null,
    "link",
  ].filter(Boolean);
  return [
    `#${rule.id} ${rule.name} [${rule.enabled ? "on" : "off"}]`,
    `  keywords: ${rule.keywords.join(", ")}${rule.fuzzy ? " (typos ok)" : ""}${rule.media_id ? `, only on post ${rule.media_id}` : ""}`,
    `  link: ${rule.link || "(none)"}`,
    `  flow: ${steps.join(" -> ")}`,
    `  public replies: ${rule.public_replies.length ? rule.public_replies.join(" | ") : "(defaults)"}`,
  ].join("\n");
}

export function describeDryRun(result: DryRunResult): string {
  const header = result.matched
    ? `Matched rule #${result.rule.id} "${result.rule.name}". Conversation ends at: ${result.finalStep}.`
    : "No rule matched.";
  const label = { user: "person", bot: "DM", public: "public reply", system: "note" } as const;
  return [
    header,
    ...result.transcript.map((line) => `  ${label[line.from]}: ${line.text.replace(/\n/g, "\n    ")}`),
  ].join("\n");
}

export function describeEvent(e: EventRow): string {
  const who = e.username ? `@${e.username}` : (e.ig_user ?? "");
  const detail = [e.text, e.error].filter(Boolean).join(" | ");
  return `${new Date(e.ts).toISOString()} ${e.kind}/${e.status} ${who} ${e.keyword ?? ""} ${detail}`
    .replace(/ +/g, " ")
    .trim();
}

const idShape = { id: z.number().int().describe("The rule id (from list_rules).") };

// ---- tools ----------------------------------------------------------------------------------------------------
export const tools: Tool[] = [
  defineTool({
    name: "opendm_status",
    description:
      "Show whether the Instagram account is connected, whether automation is on, how many rules exist and recent send counts. Start here.",
    shape: {},
    run: async (client) => {
      const s = await client.status();
      return [
        `Account: ${s.connected ? `@${s.username} (connected)` : "NOT connected"}${s.tokenError ? ` - token problem: ${s.tokenError}` : ""}`,
        `Automation: ${s.enabled ? "on" : "off"}`,
        `Rules: ${s.rules}`,
        `Sent: ${s.sentLastHour}/${s.hourlyLimit} this hour, ${s.sent24h} in 24h`,
        `Webhook URL for Meta: ${s.webhookUrl}`,
      ].join("\n");
    },
  }),

  defineTool({
    name: "opendm_list_rules",
    description: "List all keyword rules with their flows.",
    shape: {},
    run: async (client) => {
      const rules = await client.listRules();
      return rules.length ? rules.map(describeRule).join("\n\n") : "No rules yet.";
    },
  }),

  defineTool({
    name: "opendm_create_rule",
    description:
      "Create a keyword rule: when someone comments one of the keywords, reply privately, optionally ask them to follow, optionally collect an email, then send the link. Example: keywords ['AUTOMATION'], requireFollow true, link 'https://example.com/guide'. Call opendm_test_comment afterwards to preview it.",
    shape: ruleSpecShape,
    run: async (client, args) => {
      const spec = createRuleSchema.parse(args);
      const rule = await client.createRule({ keywords: spec.keywords, ...specToPayload(spec) });
      return `Created.\n${describeRule(rule)}`;
    },
  }),

  defineTool({
    name: "opendm_update_rule",
    description: "Change an existing rule. Only the fields you pass change; everything else stays as it was.",
    shape: { ...idShape, ...ruleSpecShape },
    run: async (client, { id, ...spec }) => {
      const current = await client.getRule(id);
      const rule = await client.replaceRule(id, mergePayload(ruleToPayload(current), specToPayload(spec)));
      return `Updated.\n${describeRule(rule)}`;
    },
  }),

  defineTool({
    name: "opendm_delete_rule",
    description: "Delete a rule and its in-progress conversations.",
    shape: idShape,
    run: async (client, { id }) => {
      await client.deleteRule(id);
      return `Deleted rule #${id}.`;
    },
  }),

  defineTool({
    name: "opendm_set_enabled",
    description: "Switch all automation on or off (the global switch). Rules are kept.",
    shape: { enabled: z.boolean() },
    run: async (client, { enabled }) =>
      `Automation is now ${(await client.setEnabled(enabled)).enabled ? "on" : "off"}.`,
  }),

  defineTool({
    name: "opendm_test_comment",
    description:
      "Dry run: show exactly what would be sent for a comment, without sending anything. Optionally simulate the person's replies (e.g. ['yes', 'done', 'me@x.com']), whether the follow check passes, and minutes of silence (to test the follow timeout).",
    shape: {
      comment: z.string().describe("The comment text, e.g. 'AUTOMATION please'."),
      name: z.string().optional().describe("First name for {name}."),
      replies: z.array(z.string()).optional().describe("What the person types back, in order."),
      following: z.enum(["yes", "no", "unknown"]).optional().describe("Result of the follow check."),
      waitMinutes: z.number().min(0).optional().describe("Minutes of silence at the end."),
    },
    run: async (client, args) => describeDryRun(await client.dryRun(args)),
  }),

  defineTool({
    name: "opendm_get_log",
    description: "Recent events: comments seen, messages sent, errors, skipped comments.",
    shape: {
      limit: z.number().int().min(1).max(200).optional().describe("How many events (default 30)."),
      kind: z.enum(["comment", "dm", "system", "auth"]).optional(),
    },
    run: async (client, { limit, kind }) => {
      const events = await client.log(limit ?? 30, kind);
      return events.length ? events.map(describeEvent).join("\n") : "No events yet.";
    },
  }),

  defineTool({
    name: "opendm_connect_instagram",
    description:
      "Connect the Instagram account by giving an Instagram user access token (Meta app, Instagram Login, Generate token). The token is validated and stored encrypted.",
    shape: { token: z.string().describe("The Instagram access token (starts with IGAA).") },
    run: async (client, { token }) => {
      const r = await client.connect(token);
      return `Connected @${r.username ?? r.igId}.`;
    },
  }),

  defineTool({
    name: "opendm_subscribe_webhooks",
    description:
      "Subscribe the connected account to the comments and messages webhooks. Run once after connecting and after the webhook URL is saved in the Meta app.",
    shape: {},
    run: async (client) => {
      await client.subscribe();
      return "Subscribed to comments and messages.";
    },
  }),

  defineTool({
    name: "opendm_set_hourly_limit",
    description: "Set the maximum messages sent per rolling hour. Extra messages wait in a queue.",
    shape: { hourlyLimit: z.number().int().min(1).max(5000) },
    run: async (client, { hourlyLimit }) =>
      `Hourly limit is now ${(await client.setHourlyLimit(hourlyLimit)).hourlyLimit}.`,
  }),
];
