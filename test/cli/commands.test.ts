// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HELP, parseCommand, runCommand } from "../../cli/commands.ts";
import { resetDb, workerClient } from "../support/helpers.ts";

const parse = (line: string) => parseCommand(line.match(/"[^"]*"|\S+/g)?.map((t) => t.replace(/^"|"$/g, "")) ?? []);

describe("parseCommand", () => {
  it("maps simple commands to tools", () => {
    expect(parse("status")).toEqual({ tool: "opendm_status", input: {} });
    expect(parse("rules")).toEqual({ tool: "opendm_list_rules", input: {} });
    expect(parse("off")).toEqual({ tool: "opendm_set_enabled", input: { enabled: false } });
    expect(parse("on")).toEqual({ tool: "opendm_set_enabled", input: { enabled: true } });
    expect(parse("subscribe")).toEqual({ tool: "opendm_subscribe_webhooks", input: {} });
    expect(parse("limit 60")).toEqual({ tool: "opendm_set_hourly_limit", input: { hourlyLimit: 60 } });
    expect(parse("connect IGAAxyz")).toEqual({ tool: "opendm_connect_instagram", input: { token: "IGAAxyz" } });
    expect(parse("rule delete 4")).toEqual({ tool: "opendm_delete_rule", input: { id: 4 } });
  });

  it("builds a rule from flags", () => {
    expect(
      parse(
        'rule add --keywords AUTOMATION,GUIDE --link https://x.io --follow --email optional --timeout 30 --replies "Sent!|Check DMs" --no-opener',
      ),
    ).toEqual({
      tool: "opendm_create_rule",
      input: {
        keywords: ["AUTOMATION", "GUIDE"],
        link: "https://x.io",
        requireFollow: true,
        askEmail: "optional",
        followTimeoutMinutes: 30,
        publicReplies: ["Sent!", "Check DMs"],
        openerFirst: false,
      },
    });
    expect(parse("rule update 3 --no-follow --disable")).toEqual({
      tool: "opendm_update_rule",
      input: { id: 3, requireFollow: false, enabled: false },
    });
  });

  it("builds a test from a comment and options", () => {
    expect(parse('test "AUTOMATION pls" --replies yes,done --following yes --wait 30 --name Sam')).toEqual({
      tool: "opendm_test_comment",
      input: { comment: "AUTOMATION pls", name: "Sam", replies: ["yes", "done"], following: "yes", waitMinutes: 30 },
    });
  });

  it("shows help, and explains bad usage", () => {
    expect(parse("")).toEqual({ help: true });
    expect(parse("help")).toEqual({ help: true });
    expect(() => parse("rule delete abc")).toThrow("numeric rule id");
    expect(() => parse("rule")).toThrow("Use: opendm rule");
    expect(() => parse("test")).toThrow("Usage");
    expect(() => parse("bogus")).toThrow('Unknown command "bogus"');
    expect(() => parse("--nope")).toThrow();
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
    expect(added).toContain("follow gate");
    const out = await runCommand(["test", "automation", "--replies", "yes,done", "--following", "yes"], client);
    expect(out).toContain("https://example.com/g");
    expect(await runCommand(["rules"], client)).toContain("AUTOMATION");
    await runCommand(["off"], client);
    expect(await runCommand(["status"], client)).toContain("Automation: off");
    expect(await runCommand(["help"], client)).toBe(HELP);
  });
});
