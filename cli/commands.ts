// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The `opendm` command line: parses arguments and runs the matching tool. Output is plain text, or JSON with --json.
import type { OpenDmClient } from "../src/mcp/client.ts";
import { tools } from "../src/mcp/tools.ts";
import { type FlagValues, list, numberOf, parseArgs, stringOf } from "./args.ts";
import { runSetup, SETUP_HELP } from "./setup.ts";

/** Exit codes: 0 ok, 1 error, 2 a person has to do something (login, Meta app, comment from another account). */
export const EXIT = { ok: 0, error: 1, needsHuman: 2 } as const;

export interface CommandResult {
  text: string;
  /** Structured result for --json. */
  json: unknown;
  exitCode: number;
}

export const HELP = `opendm - manage your OpenDM instance from the terminal

Set OPENDM_URL (https://<your-worker>.workers.dev) and OPENDM_TOKEN (your ADMIN_PASSWORD).
Every command accepts --json (machine-readable output). Exit codes: 0 ok, 1 error, 2 needs a person.

  opendm status                       accounts, switch, counts, webhook URL
  opendm health                       is the Worker up
  opendm setup [...]                  guided onboarding (see "opendm setup help")
  opendm rules                        list rules
  opendm rule show <id>
  opendm rule add --keywords A,B --link URL [options]
  opendm rule update <id> [options]
  opendm rule messages <id> --messages '{"openerText":["Hi!","Hey!"]}' [--rotation random]
  opendm rule delete <id>
  opendm on | off                     global automation switch
  opendm test "<comment>" [--platform facebook] [--variant N] [--replies yes,done] [--following yes|no] [--wait MIN]
  opendm log [--limit N] [--kind comment|dm|system]
  opendm conversations [--step awaiting_follow]
  opendm leads                        emails captured by flows
  opendm queue                        messages waiting to send
  opendm connect <instagram-token>
  opendm disconnect --platform instagram|facebook
  opendm subscribe [--platform facebook]
  opendm refresh-token
  opendm limit <per-hour>

Rule options:
  --name TEXT            --post MEDIA_ID        --replies "a|b"    --no-typos
  --channel instagram|facebook|both             --dm-trigger | --no-dm-trigger   also start on keyword DMs
  --follow | --no-follow ask them to follow     --timeout MINUTES  follow-question timeout
  --email off|optional|required                 --no-opener        link straight in the private reply
  --opener TEXT  --follow-text TEXT  --email-text TEXT  --final TEXT
  --rotation round_robin|random                 --disable | --enable`;

/** CLI flags -> the friendly rule spec the tools take. */
function ruleSpecFromFlags(v: FlagValues): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    name: v.name,
    keywords: list(v.keywords),
    link: v.link,
    mediaId: v.post,
    channel: v.channel,
    dmTrigger: v["no-dm-trigger"] ? false : v["dm-trigger"] ? true : undefined,
    publicReplies: list(v.replies, "|"),
    allowTypos: v["no-typos"] ? false : undefined,
    requireFollow: v["no-follow"] ? false : v.follow ? true : undefined,
    followTimeoutMinutes: numberOf(v.timeout),
    askEmail: v.email,
    openerFirst: v["no-opener"] ? false : undefined,
    openerText: v.opener,
    followText: v["follow-text"],
    emailText: v["email-text"],
    finalMessage: v.final,
    rotation: v.rotation,
    messages: typeof v.messages === "string" ? JSON.parse(v.messages) : undefined,
    enabled: v.disable ? false : v.enable ? true : undefined,
  };
  return Object.fromEntries(Object.entries(spec).filter(([, value]) => value !== undefined));
}

type Parsed =
  | { kind: "help" }
  | { kind: "setup"; args: string[]; values: FlagValues }
  | { kind: "tool"; tool: string; input: Record<string, unknown> };

const platformOf = (v: FlagValues) => (v.platform === "facebook" ? "facebook" : "instagram");

/** Maps a command line to a tool and its input. Throws a readable Error for bad usage. */
export function parseCommand(argv: string[]): Parsed {
  const { values, positionals } = parseArgs(argv);
  const [command, sub, third] = positionals;
  const needId = (raw: string | undefined) => {
    const id = Number(raw);
    if (!Number.isInteger(id)) throw new Error("A numeric rule id is required.");
    return id;
  };
  const tool = (name: string, input: Record<string, unknown> = {}): Parsed => ({ kind: "tool", tool: name, input });

  switch (command) {
    case undefined:
    case "help":
      return { kind: "help" };
    case "setup":
      return { kind: "setup", args: positionals.slice(1), values };
    case "status":
      return tool("opendm_status");
    case "health":
      return tool("opendm_health");
    case "rules":
      return tool("opendm_list_rules");
    case "rule":
      if (sub === "show") return tool("opendm_get_rule", { id: needId(third) });
      if (sub === "add") return tool("opendm_create_rule", ruleSpecFromFlags(values));
      if (sub === "update") return tool("opendm_update_rule", { id: needId(third), ...ruleSpecFromFlags(values) });
      if (sub === "messages") return tool("opendm_set_messages", { id: needId(third), ...ruleSpecFromFlags(values) });
      if (sub === "delete") return tool("opendm_delete_rule", { id: needId(third) });
      throw new Error("Use: opendm rule show|add|update|messages|delete");
    case "on":
    case "off":
      return tool("opendm_set_enabled", { enabled: command === "on" });
    case "test":
      if (!sub) throw new Error('Usage: opendm test "<comment>"');
      return tool("opendm_test_comment", {
        comment: sub,
        platform: stringOf(values.platform),
        variant: numberOf(values.variant),
        name: values.name,
        replies: list(values.replies),
        following: values.following,
        waitMinutes: numberOf(values.wait),
      });
    case "log":
      return tool("opendm_get_log", { limit: numberOf(values.limit), kind: values.kind });
    case "conversations":
      return tool("opendm_list_conversations", { step: values.step, limit: numberOf(values.limit) });
    case "leads":
      return tool("opendm_list_leads");
    case "queue":
      return tool("opendm_get_queue");
    case "connect":
      if (!sub) throw new Error("Usage: opendm connect <instagram-token>");
      return tool("opendm_connect_instagram", { token: sub });
    case "disconnect":
      return tool("opendm_disconnect", { platform: platformOf(values) });
    case "subscribe":
      return tool("opendm_subscribe_webhooks", { platform: platformOf(values) });
    case "refresh-token":
      return tool("opendm_refresh_token");
    case "limit":
      return tool("opendm_set_hourly_limit", { hourlyLimit: Number(sub) });
    default:
      throw new Error(`Unknown command "${command}". Run: opendm help`);
  }
}

/** Runs one command line. Errors are returned as results with exit code 1 so --json callers always get JSON. */
export async function runCommand(argv: string[], client: OpenDmClient): Promise<CommandResult> {
  const parsed = parseCommand(argv);
  if (parsed.kind === "help") return { text: HELP, json: { help: HELP }, exitCode: EXIT.ok };
  if (parsed.kind === "setup") return runSetup(parsed.args, parsed.values, client);
  const tool = tools.find((t) => t.name === parsed.tool);
  if (!tool) throw new Error(`No such tool: ${parsed.tool}`);
  const text = await tool.run(client, parsed.input);
  return { text, json: { ok: true, output: text }, exitCode: EXIT.ok };
}

export { SETUP_HELP };
