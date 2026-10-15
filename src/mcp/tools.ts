// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Everything Claude (over MCP) and the CLI can do with OpenDM. One definition feeds both.
import { z } from "zod";
import type { DryRunResult, EventRow, Rule, SetupReport, Status } from "../types/api.ts";
import type { Conversation, OpenDmClient } from "./client.ts";
import {
  createRuleSchema,
  MESSAGE_KEYS,
  mergePayload,
  ruleSpecShape,
  ruleToPayload,
  specToPayload,
} from "./rule-spec.ts";

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

// ---- formatting -------------------------------------------------------------------------------------------------
export function describeRule(rule: Rule): string {
  const f = rule.flow;
  const steps = [
    f.opener || f.requireFollow || f.askEmail !== "off" ? "opener" : "link straight in the private reply",
    f.requireFollow ? `follow gate (timeout ${f.followTimeoutMin} min)` : null,
    f.askEmail !== "off" ? `email (${f.askEmail})` : null,
    "link",
  ].filter(Boolean);
  const multi = Object.entries(f.variants)
    .filter(([, list]) => list && list.length > 1)
    .map(([key, list]) => `${key} x${list?.length}`);
  return [
    `#${rule.id} ${rule.name} [${rule.enabled ? "on" : "off"}] channel: ${rule.channel}${rule.dm_trigger ? ", also keyword DMs" : ""}`,
    `  keywords: ${rule.keywords.join(", ")}${rule.fuzzy ? " (typos ok)" : ""}${rule.media_id ? `, only on post ${rule.media_id}` : ""}`,
    `  link: ${rule.link || "(none)"}`,
    `  flow: ${steps.join(" -> ")}`,
    `  public replies: ${rule.public_replies.length ? rule.public_replies.join(" | ") : "(defaults)"}`,
    ...(multi.length ? [`  message variants (${f.rotation}): ${multi.join(", ")}`] : []),
  ].join("\n");
}

export function describeDryRun(result: DryRunResult): string {
  const header = result.matched
    ? `Matched rule #${result.rule.id} "${result.rule.name}". Conversation ends at: ${result.finalStep}.`
    : "No rule matched.";
  const label = { user: "person", bot: "DM", public: "public reply", system: "note" } as const;
  /** The wording used, e.g. "openerText#2/3", when the step had several. */
  const wording = (note?: string) => note?.match(/\((\w+#\d+\/\d+)\)/)?.[1];
  const lines = result.transcript.map((line) => {
    const tag = wording(line.note);
    return `  ${label[line.from]}: ${line.text.replace(/\n/g, "\n    ")}${tag ? ` [${tag}]` : ""}`;
  });
  return [header, ...lines].join("\n");
}

export function describeEvent(e: EventRow): string {
  const who = e.username ? `@${e.username}` : (e.ig_user ?? "");
  const detail = [e.text, e.error].filter(Boolean).join(" | ");
  const parts = [
    new Date(e.ts).toISOString(),
    `${e.platform ?? "-"}/${e.kind}/${e.status}`,
    who,
    e.keyword ?? "",
    e.variant ? `[${e.variant}]` : "",
    detail,
  ];
  return parts.filter(Boolean).join(" ");
}

const describeConversation = (c: Conversation) =>
  `#${c.id} ${c.platform} ${c.username ? `@${c.username}` : c.ig_user} rule "${c.rule_name ?? c.rule_id}" ${c.step}${c.email ? ` email: ${c.email}` : ""} (${new Date(c.updated).toISOString()})`;

function describeSetup(report: SetupReport): string {
  const mark = { ok: "[x]", todo: "[ ]", warn: "[!]", info: "[i]" } as const;
  const lines = report.steps.map((s) => `${mark[s.status]} ${s.title}: ${s.detail}`);
  if (report.ready) return [...lines, "", "Setup is complete."].join("\n");
  const next = report.next;
  return [
    ...lines,
    "",
    `NEXT: ${next?.title}`,
    `  ${next?.help ?? ""}`,
    ...(next?.needsHuman
      ? [
          "  A PERSON has to do this step (login, Meta app, or commenting from another account). Ask the user, then re-run setup_status.",
        ]
      : []),
  ].join("\n");
}

function describeStatus(s: Status): string {
  const channel = (name: string, c: Status["channels"]["instagram"]) =>
    `${name}: ${c.connected ? `${c.name ?? c.id} (${c.mode?.replace("_", " ")})${c.tokenError ? ` - token problem: ${c.tokenError}` : ""}` : "NOT connected"}`;
  return [
    channel("Instagram", s.channels.instagram),
    channel("Facebook Page", s.channels.facebook),
    `Automation: ${s.enabled ? "on" : "off"}`,
    `Rules: ${s.rules}`,
    `Sent: ${s.sentLastHour}/${s.hourlyLimit} this hour, ${s.sent24h} in 24h`,
    `Webhook URL for Meta: ${s.webhookUrl}`,
  ].join("\n");
}

const idShape = { id: z.number().int().describe("The rule id (from list_rules).") };
const platformShape = { platform: z.enum(["instagram", "facebook"]).describe("Which platform.") };

// ---- tools ------------------------------------------------------------------------------------------------------
export const tools: Tool[] = [
  // Setup and accounts
  defineTool({
    name: "opendm_status",
    description:
      "Overview: which accounts are connected (Instagram, Facebook Page), whether automation is on, rule count, send counts and the webhook URL. Start here.",
    shape: {},
    run: async (client) => describeStatus(await client.status()),
  }),
  defineTool({
    name: "opendm_setup_status",
    description:
      "The onboarding checklist with the next step and whether a person must act. Use it to walk a user from zero to live; re-run after each step. Returns steps: server, app credentials, connect, token, webhook, events, rule, comment, review.",
    shape: {},
    run: async (client) => describeSetup(await client.setupReport()),
  }),
  defineTool({
    name: "opendm_setup_checks",
    description:
      "Live checks against Meta: is each token accepted, is the webhook subscribed, did a signed event arrive.",
    shape: {},
    run: async (client) =>
      (await client.setupChecks()).map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`).join("\n"),
  }),
  defineTool({
    name: "opendm_get_webhook_details",
    description:
      "The callback URL and verify token to paste into the Meta app's webhook form. The verify token is a credential: show it to the user only so they can paste it into Meta, never in logs or commits.",
    shape: {},
    run: async (client) => {
      const s = await client.status();
      return `Callback URL: ${s.webhookUrl}\nVerify token: ${s.verifyToken}\nSubscribe to: comments and messages (Instagram), feed and messages (Facebook Page).`;
    },
  }),
  defineTool({
    name: "opendm_set_app_credentials",
    description:
      "Save the Meta app ID and secret for a platform (the secret is stored encrypted). Needed before OAuth and for webhook signature checks.",
    shape: { ...platformShape, appId: z.string(), appSecret: z.string().optional() },
    run: async (client, { platform, appId, appSecret }) => {
      await client.setAppCredentials(platform, appId, appSecret);
      return `Saved the ${platform} app credentials${appSecret ? "" : " (ID only)"}.`;
    },
  }),
  defineTool({
    name: "opendm_get_oauth_url",
    description:
      "The URL the user opens to authorize OpenDM with Instagram Login or Facebook Login. It redirects back to the dashboard, which finishes the connection. Needs the app ID saved first.",
    shape: platformShape,
    run: async (client, { platform }) =>
      `Ask the user to open this URL while logged in to the OpenDM dashboard in the same browser:\n${(await client.oauthUrl(platform)).url}`,
  }),
  defineTool({
    name: "opendm_exchange_token",
    description:
      "Turn a token the user pasted into a stored connection. Instagram: a short- or long-lived Instagram token (upgraded to 60 days when the app secret is saved). Facebook: a user token (then pick a Page) or a Page token.",
    shape: { ...platformShape, token: z.string() },
    run: async (client, { platform, token }) => (await client.exchangeToken(platform, token)).message,
  }),
  defineTool({
    name: "opendm_connect_instagram",
    description:
      "Connect Instagram with an Instagram user access token (Meta app > Instagram Login > Generate token). Validated and stored encrypted.",
    shape: { token: z.string().describe("The Instagram access token (starts with IGAA).") },
    run: async (client, { token }) => {
      const r = await client.connect(token);
      return `Connected @${r.username ?? r.igId}.`;
    },
  }),
  defineTool({
    name: "opendm_connect_facebook",
    description:
      "Connect a Facebook Page with a Page access token, or a user token (then choose the Page with opendm_select_facebook_page). Also links the Page's Instagram account for Instagram through Facebook Login.",
    shape: { token: z.string(), pageId: z.string().optional().describe("Which Page, when the token can see several.") },
    run: async (client, { token, pageId }) => {
      const r = await client.connectFacebook(token, pageId);
      if (r.connected)
        return `Connected Facebook Page ${r.page.name}${r.page.instagram ? ` with Instagram @${r.page.instagram.username ?? r.page.instagram.id}` : ""}.`;
      return `Choose a Page with opendm_select_facebook_page:\n${r.pages.map((p) => `  ${p.id} ${p.name}`).join("\n")}`;
    },
  }),
  defineTool({
    name: "opendm_list_facebook_pages",
    description: "Pages available to the Facebook user token that was connected.",
    shape: {},
    run: async (client) =>
      (await client.facebookPages())
        .map((p) => `${p.id} ${p.name}${p.instagram ? ` (Instagram @${p.instagram.username ?? p.instagram.id})` : ""}`)
        .join("\n") || "No Pages.",
  }),
  defineTool({
    name: "opendm_select_facebook_page",
    description: "Connect one of the Pages from opendm_list_facebook_pages.",
    shape: { pageId: z.string() },
    run: async (client, { pageId }) => {
      const r = await client.selectFacebookPage(pageId);
      return r.connected ? `Connected Facebook Page ${r.page.name}.` : "Page not connected.";
    },
  }),
  defineTool({
    name: "opendm_disconnect",
    description: "Disconnect Instagram or the Facebook Page. Ask the user first.",
    shape: platformShape,
    run: async (client, { platform }) => {
      await client.disconnect(platform);
      return `Disconnected ${platform}.`;
    },
  }),
  defineTool({
    name: "opendm_subscribe_webhooks",
    description:
      "Subscribe the connected account to its webhooks (Instagram: comments + messages; Facebook: feed + messages). Run after connecting and after the callback URL is saved in the Meta app.",
    shape: { platform: z.enum(["instagram", "facebook"]).optional().describe("Default instagram.") },
    run: async (client, { platform }) => {
      await client.subscribe(platform ?? "instagram");
      return `Subscribed ${platform ?? "instagram"} to its webhooks.`;
    },
  }),
  defineTool({
    name: "opendm_refresh_token",
    description: "Force a refresh of the Instagram Login token now (it also refreshes automatically).",
    shape: {},
    run: async (client) => (await client.refreshToken()).result,
  }),
  defineTool({
    name: "opendm_send_test",
    description:
      "End-to-end check that does not message anyone: the live Meta checks plus a dry run of a comment. Use it as the last onboarding step and after changes. Without a comment it uses the first rule's keyword.",
    shape: { comment: z.string().optional(), platform: z.enum(["instagram", "facebook"]).optional() },
    run: async (client, { comment, platform }) => {
      const checks = (await client.setupChecks()).map((c) => `${c.ok ? "ok  " : "FAIL"} ${c.name}: ${c.detail}`);
      const rules = await client.listRules();
      const text = comment ?? rules[0]?.keywords[0];
      const dry = text
        ? describeDryRun(await client.dryRun({ comment: text, platform, replies: ["yes", "done"], following: "yes" }))
        : "No rule yet to dry-run.";
      return [...checks, "", dry].join("\n");
    },
  }),

  // Rules and flows
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
    name: "opendm_get_rule",
    description: "One rule in full, including the exact message texts and variants.",
    shape: idShape,
    run: async (client, { id }) => {
      const rule = await client.getRule(id);
      return [
        describeRule(rule),
        "",
        "Messages:",
        ...MESSAGE_KEYS.map((key) => `  ${key}: ${JSON.stringify(rule.flow.variants[key] ?? [rule.flow[key]])}`),
      ].join("\n");
    },
  }),
  defineTool({
    name: "opendm_create_rule",
    description:
      "Create a keyword rule: when someone comments one of the keywords, reply privately, optionally ask them to follow, optionally collect an email, then send the link. Example: keywords ['AUTOMATION'], requireFollow true, link 'https://example.com/guide'. Use channel 'both' for Instagram and Facebook; messages for several wordings per message. Call opendm_test_comment afterwards.",
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
    name: "opendm_set_messages",
    description:
      "Set the wordings (variants) of one or more messages of a rule and how they rotate. Example: messages {openerText: ['Hey! Want the link?', 'Hi there, want it?']}, rotation round_robin. Placeholders {name} {keyword} {link} {account} work in every variant.",
    shape: {
      ...idShape,
      messages: ruleSpecShape.messages.unwrap(),
      rotation: ruleSpecShape.rotation,
      publicReplies: ruleSpecShape.publicReplies,
    },
    run: async (client, { id, ...spec }) => {
      const current = await client.getRule(id);
      const rule = await client.replaceRule(id, mergePayload(ruleToPayload(current), specToPayload(spec)));
      return `Updated messages.\n${describeRule(rule)}`;
    },
  }),
  defineTool({
    name: "opendm_delete_rule",
    description: "Delete a rule and its in-progress conversations. Ask the user first.",
    shape: idShape,
    run: async (client, { id }) => {
      await client.deleteRule(id);
      return `Deleted rule #${id}.`;
    },
  }),
  defineTool({
    name: "opendm_test_comment",
    description:
      "Dry run: show exactly what would be sent for a comment, without sending anything. Optionally simulate the person's replies (e.g. ['yes', 'done', 'me@x.com']), whether the follow check passes, minutes of silence (to test the follow timeout), the platform, and which wording (variant 1, 2, ...) to preview.",
    shape: {
      comment: z.string().describe("The comment text, e.g. 'AUTOMATION please'."),
      platform: z.enum(["instagram", "facebook"]).optional(),
      variant: z.number().int().min(1).optional().describe("Preview this wording (1-based) of every message."),
      name: z.string().optional().describe("First name for {name}."),
      replies: z.array(z.string()).optional().describe("What the person types back, in order."),
      following: z.enum(["yes", "no", "unknown"]).optional().describe("Result of the follow check."),
      waitMinutes: z.number().min(0).optional().describe("Minutes of silence at the end."),
    },
    run: async (client, args) => describeDryRun(await client.dryRun(args)),
  }),
  defineTool({
    name: "opendm_set_enabled",
    description: "Switch all automation on or off (the global switch). Rules are kept.",
    shape: { enabled: z.boolean() },
    run: async (client, { enabled }) =>
      `Automation is now ${(await client.setEnabled(enabled)).enabled ? "on" : "off"}.`,
  }),
  defineTool({
    name: "opendm_set_hourly_limit",
    description: "Set the maximum messages sent per rolling hour. Extra messages wait in a queue.",
    shape: { hourlyLimit: z.number().int().min(1).max(5000) },
    run: async (client, { hourlyLimit }) =>
      `Hourly limit is now ${(await client.setHourlyLimit(hourlyLimit)).hourlyLimit}.`,
  }),

  // Activity
  defineTool({
    name: "opendm_get_log",
    description:
      "Recent events: comments seen, messages sent (with the wording variant used), errors, skipped comments.",
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
    name: "opendm_list_conversations",
    description:
      "Conversations in progress or finished: who, which rule, which step (opened, awaiting_follow, awaiting_email, done, stopped), email if given.",
    shape: {
      step: z.enum(["opened", "awaiting_follow", "awaiting_email", "done", "stopped"]).optional(),
      limit: z.number().int().min(1).max(500).optional(),
    },
    run: async (client, { step, limit }) => {
      const list = await client.conversations(step, limit);
      return list.length ? list.map(describeConversation).join("\n") : "No conversations.";
    },
  }),
  defineTool({
    name: "opendm_list_leads",
    description: "People who gave their email address in a flow.",
    shape: {},
    run: async (client) => {
      const leads = await client.leads();
      return leads.length
        ? leads
            .map(
              (l) =>
                `${l.email}\t${l.platform} ${l.username ? `@${l.username}` : l.ig_user}\t${l.rule_name ?? ""}\t${new Date(l.updated).toISOString()}`,
            )
            .join("\n")
        : "No emails captured yet.";
    },
  }),
  defineTool({
    name: "opendm_get_queue",
    description: "Messages waiting to be sent (over the hourly cap, or retrying after an error).",
    shape: {},
    run: async (client) => {
      const pending = await client.queue();
      return pending.length
        ? pending
            .map(
              (p) =>
                `#${p.id} ${p.job.platform}/${p.job.kind} attempts ${p.attempts} due ${new Date(p.due).toISOString()}${p.error ? ` (${p.error})` : ""}`,
            )
            .join("\n")
        : "The queue is empty.";
    },
  }),
  defineTool({
    name: "opendm_health",
    description: "Is the Worker reachable? Returns name and version. Needs no authentication.",
    shape: {},
    run: async (client) => {
      const h = await client.health();
      return `${h.name} ${h.version}: ${h.ok ? "ok" : "not ok"}`;
    },
  }),
];
