// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT, HELP, parseCommand, runCommand } from "../../cli/commands.ts";
import { resetDb, workerClient } from "../support/helpers.ts";

const parse = (line: string) =>
  parseCommand(line.match(/"[^"]*"|'[^']*'|\S+/g)?.map((t) => t.replace(/^["']|["']$/g, "")) ?? []);
const tool = (name: string, input: Record<string, unknown> = {}) => ({ kind: "tool", tool: name, input });

describe("parseCommand", () => {
  it("maps simple commands to tools", () => {
    expect(parse("status")).toEqual(tool("opendm_status"));
    expect(parse("health")).toEqual(tool("opendm_health"));
    expect(parse("rules")).toEqual(tool("opendm_list_rules"));
    expect(parse("off")).toEqual(tool("opendm_set_enabled", { enabled: false }));
    expect(parse("on")).toEqual(tool("opendm_set_enabled", { enabled: true }));
    expect(parse("subscribe")).toEqual(tool("opendm_subscribe_webhooks", { platform: "instagram" }));
    expect(parse("subscribe --platform facebook")).toEqual(tool("opendm_subscribe_webhooks", { platform: "facebook" }));
    expect(parse("limit 60")).toEqual(tool("opendm_set_hourly_limit", { hourlyLimit: 60 }));
    expect(parse("connect IGAAxyz")).toEqual(tool("opendm_connect_instagram", { token: "IGAAxyz" }));
    expect(parse("rule delete 4")).toEqual(tool("opendm_delete_rule", { id: 4 }));
    expect(parse("rule show 2")).toEqual(tool("opendm_get_rule", { id: 2 }));
    expect(parse("leads")).toEqual(tool("opendm_list_leads"));
    expect(parse("queue")).toEqual(tool("opendm_get_queue"));
    expect(parse("refresh-token")).toEqual(tool("opendm_refresh_token"));
  });

  it("builds a rule from flags, including channel, DM trigger and variants", () => {
    expect(
      parse(
        'rule add --keywords AUTOMATION,GUIDE --link https://x.io --follow --email optional --timeout 30 --replies "Sent!|Check DMs" --no-opener --channel both --dm-trigger --rotation random',
      ),
    ).toEqual(
      tool("opendm_create_rule", {
        keywords: ["AUTOMATION", "GUIDE"],
        link: "https://x.io",
        channel: "both",
        dmTrigger: true,
        requireFollow: true,
        askEmail: "optional",
        followTimeoutMinutes: 30,
        publicReplies: ["Sent!", "Check DMs"],
        openerFirst: false,
        rotation: "random",
      }),
    );
    expect(parse("rule update 3 --no-follow --disable")).toEqual(
      tool("opendm_update_rule", { id: 3, requireFollow: false, enabled: false }),
    );
    expect(parse(`rule messages 3 --messages '{"openerText":["a","b"]}'`)).toEqual(
      tool("opendm_set_messages", { id: 3, messages: { openerText: ["a", "b"] } }),
    );
  });

  it("builds a test from a comment and options", () => {
    expect(
      parse(
        'test "AUTOMATION pls" --replies yes,done --following yes --wait 30 --name Sam --platform facebook --variant 2',
      ),
    ).toEqual(
      tool("opendm_test_comment", {
        comment: "AUTOMATION pls",
        platform: "facebook",
        variant: 2,
        name: "Sam",
        replies: ["yes", "done"],
        following: "yes",
        waitMinutes: 30,
      }),
    );
  });

  it("routes setup commands to the setup runner", () => {
    expect(parse("setup status --json")).toEqual({ kind: "setup", args: ["status"], values: { json: true } });
  });

  it("shows help, and explains bad usage", () => {
    expect(parse("")).toEqual({ kind: "help" });
    expect(parse("help")).toEqual({ kind: "help" });
    expect(() => parse("rule delete abc")).toThrow("numeric rule id");
    expect(() => parse("rule")).toThrow("Use: opendm rule");
    expect(() => parse("test")).toThrow("Usage");
    expect(() => parse("bogus")).toThrow('Unknown command "bogus"');
    expect(() => parse("--nope")).toThrow();
    expect(() => parse("rules --limit")).toThrow("needs a value");
  });
});

describe("runCommand against the Worker", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDb();
  });

  it("creates a rule, tests it and removes it from the command line", async () => {
    const client = workerClient();
    const added = await runCommand(
      ["rule", "add", "--keywords", "AUTOMATION", "--link", "https://example.com/g", "--follow"],
      client,
    );
    expect(added.text).toContain("follow gate");
    expect(added.exitCode).toBe(EXIT.ok);
    const out = await runCommand(["test", "automation", "--replies", "yes,done", "--following", "yes"], client);
    expect(out.text).toContain("https://example.com/g");
    expect((await runCommand(["rules"], client)).text).toContain("AUTOMATION");
    await runCommand(["off"], client);
    expect((await runCommand(["status"], client)).text).toContain("Automation: off");
    const help = await runCommand(["help"], client);
    expect(help.text).toBe(HELP);
    expect(help.json).toEqual({ help: HELP });
  });
});
