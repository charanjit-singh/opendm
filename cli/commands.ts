// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The `opendm` command line: parses arguments and runs the matching tool. Output is plain text.
import type { OpenDmClient } from "./client.ts";
import { tools } from "./tools.ts";

export const HELP = `opendm - manage your OpenDM instance from the terminal

Set OPENDM_URL (https://<your-worker>.workers.dev) and OPENDM_TOKEN (your ADMIN_PASSWORD).

  opendm status                       connection, switch, counts, webhook URL
  opendm rules                        list rules
  opendm rule add --keywords A,B --link URL [options]
  opendm rule update <id> [options]
  opendm rule delete <id>
  opendm on | off                     global automation switch
  opendm test "<comment>" [--replies yes,done,me@x.com] [--following yes|no] [--wait MIN] [--name NAME]
  opendm log [--limit N] [--kind comment|dm|system]
  opendm connect <instagram-token>
  opendm subscribe                    subscribe to comments + messages webhooks
  opendm limit <per-hour>

Rule options:
  --name TEXT            --post MEDIA_ID        --replies "a|b"    --no-typos
  --follow | --no-follow ask them to follow     --timeout MINUTES  follow-question timeout
  --email off|optional|required                 --no-opener        link straight in the private reply
  --opener TEXT  --follow-text TEXT  --email-text TEXT  --final TEXT
  --disable              create/update the rule switched off`;

/** Flags that take no value. Every other --flag takes the next argument. */
const BOOLEAN_FLAGS = new Set(["no-typos", "follow", "no-follow", "no-opener", "disable", "enable"]);

interface ParsedArgs {
  values: Record<string, string | boolean | undefined>;
  positionals: string[];
}

/** Minimal long-flag parser: "--key value", "--switch", everything else is a positional argument. */
function parseArgs(argv: string[]): ParsedArgs {
  const values: ParsedArgs["values"] = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) {
      values[key] = true;
    } else if (key in FLAG_NAMES) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      values[key] = value;
    } else {
      throw new Error(`Unknown option --${key}. Run: opendm help`);
    }
  }
  return { values, positionals };
}

const FLAG_NAMES: Record<string, true> = Object.fromEntries(
  [
    "keywords",
    "link",
    "name",
    "post",
    "replies",
    "timeout",
    "email",
    "opener",
    "follow-text",
    "email-text",
    "final",
    "following",
    "wait",
    "limit",
    "kind",
  ].map((k) => [k, true]),
);

const list = (value: string | boolean | undefined, separator = ","): string[] | undefined =>
  typeof value !== "string"
    ? undefined
    : value
        .split(separator)
        .map((part) => part.trim())
        .filter(Boolean);

const numberOrUndefined = (value: string | boolean | undefined): number | undefined =>
  typeof value !== "string" ? undefined : Number(value);

type Values = ParsedArgs["values"];

/** CLI flags -> the friendly rule spec the tools take. */
function ruleSpecFromFlags(v: Values): Record<string, unknown> {
  const spec: Record<string, unknown> = {
    name: v.name,
    keywords: list(v.keywords),
    link: v.link,
    mediaId: v.post,
    publicReplies: list(v.replies, "|"),
    allowTypos: v["no-typos"] ? false : undefined,
    requireFollow: v["no-follow"] ? false : v.follow ? true : undefined,
    followTimeoutMinutes: numberOrUndefined(v.timeout),
    askEmail: v.email,
    openerFirst: v["no-opener"] ? false : undefined,
    openerText: v.opener,
    followText: v["follow-text"],
    emailText: v["email-text"],
    finalMessage: v.final,
    enabled: v.disable ? false : v.enable ? true : undefined,
  };
  return Object.fromEntries(Object.entries(spec).filter(([, value]) => value !== undefined));
}

/** Maps a command line to a tool name and its input. Throws a readable Error for bad usage. */
export function parseCommand(argv: string[]): { tool: string; input: Record<string, unknown> } | { help: true } {
  const { values, positionals } = parseArgs(argv);
  const [command, sub, third] = positionals;
  const needId = (raw: string | undefined) => {
    const id = Number(raw);
    if (!Number.isInteger(id)) throw new Error("A numeric rule id is required.");
    return id;
  };

  switch (command) {
    case undefined:
    case "help":
      return { help: true };
    case "status":
      return { tool: "opendm_status", input: {} };
    case "rules":
      return { tool: "opendm_list_rules", input: {} };
    case "rule":
      if (sub === "add") return { tool: "opendm_create_rule", input: ruleSpecFromFlags(values) };
      if (sub === "update")
        return { tool: "opendm_update_rule", input: { id: needId(third), ...ruleSpecFromFlags(values) } };
      if (sub === "delete") return { tool: "opendm_delete_rule", input: { id: needId(third) } };
      throw new Error("Use: opendm rule add|update|delete");
    case "on":
    case "off":
      return { tool: "opendm_set_enabled", input: { enabled: command === "on" } };
    case "test":
      if (!sub) throw new Error('Usage: opendm test "<comment>"');
      return {
        tool: "opendm_test_comment",
        input: {
          comment: sub,
          name: values.name,
          replies: list(values.replies),
          following: values.following,
          waitMinutes: numberOrUndefined(values.wait),
        },
      };
    case "log":
      return { tool: "opendm_get_log", input: { limit: numberOrUndefined(values.limit), kind: values.kind } };
    case "connect":
      if (!sub) throw new Error("Usage: opendm connect <instagram-token>");
      return { tool: "opendm_connect_instagram", input: { token: sub } };
    case "subscribe":
      return { tool: "opendm_subscribe_webhooks", input: {} };
    case "limit":
      return { tool: "opendm_set_hourly_limit", input: { hourlyLimit: Number(sub) } };
    default:
      throw new Error(`Unknown command "${command}". Run: opendm help`);
  }
}

/** Runs one command line and returns what to print. */
export async function runCommand(argv: string[], client: OpenDmClient): Promise<string> {
  const parsed = parseCommand(argv);
  if ("help" in parsed) return HELP;
  const tool = tools.find((t) => t.name === parsed.tool);
  if (!tool) throw new Error(`No such tool: ${parsed.tool}`);
  return tool.run(client, parsed.input);
}
