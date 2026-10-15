// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The Claude-facing tools (MCP + CLI) against the real Worker.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OpenDmError } from "../../cli/client.ts";
import { tools } from "../../cli/tools.ts";
import { mockGraph, resetDb, workerClient } from "../support/helpers.ts";

const run = (name: string, input: unknown = {}, client = workerClient()) => {
  const tool = tools.find((t) => t.name === name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.run(client, input);
};

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("client auth", () => {
  it("rejects a wrong token with the API's message", async () => {
    await expect(workerClient("nope").status()).rejects.toMatchObject({
      name: "Error",
      status: 401,
      message: "Wrong password",
    });
    await expect(workerClient("nope").status()).rejects.toBeInstanceOf(OpenDmError);
  });
});

describe("creating a flow in plain terms", () => {
  const spec = {
    keywords: ["AUTOMATION"],
    link: "https://example.com/automation-guide",
    requireFollow: true,
    askEmail: "off",
  };

  it("'whenever someone comments AUTOMATION, DM them, ask them to follow, then send the link'", async () => {
    const created = await run("opendm_create_rule", { name: "Automation guide", ...spec });
    expect(created).toContain("Created.");
    expect(created).toContain("keywords: AUTOMATION");
    expect(created).toContain("opener -> follow gate");

    const [rule] = await workerClient().listRules();
    expect(rule).toMatchObject({ keywords: ["AUTOMATION"], link: spec.link, enabled: true });
    expect(rule.flow).toMatchObject({ requireFollow: true, askEmail: "off", opener: true });
  });

  it("the dry run shows the whole conversation the new rule produces", async () => {
    await run("opendm_create_rule", spec);
    const out = await run("opendm_test_comment", {
      comment: "automation!",
      name: "Sam",
      replies: ["yes", "done"],
      following: "yes",
    });
    expect(out).toContain("Matched rule");
    expect(out).toContain("person: automation!");
    expect(out).toContain("follow @");
    expect(out).toContain("DM: Here you go:");
    expect(out).toContain("https://example.com/automation-guide");
    expect(out).toContain("Conversation ends at: done");
  });

  it("can turn the follow gate off and add an email step with custom messages", async () => {
    await run("opendm_create_rule", {
      ...spec,
      requireFollow: false,
      askEmail: "optional",
      finalMessage: "Enjoy! {link}",
      followTimeoutMinutes: 30,
    });
    const [rule] = await workerClient().listRules();
    expect(rule.flow).toMatchObject({
      requireFollow: false,
      askEmail: "optional",
      deliverText: "Enjoy! {link}",
      followTimeoutMin: 30,
    });
    const out = await run("opendm_test_comment", { comment: "AUTOMATION", replies: ["yes", "me@x.io"] });
    expect(out).toContain("DM: Enjoy! https://example.com/automation-guide");
  });

  it("explains a missing keyword instead of crashing", async () => {
    await expect(run("opendm_create_rule", { link: "https://example.com" })).rejects.toThrow(/keywords/);
  });

  it("surfaces the API's validation message", async () => {
    await expect(run("opendm_create_rule", { keywords: ["X"], link: "ftp://nope" })).rejects.toThrow(/http/);
  });
});

describe("managing rules", () => {
  it("lists, updates (merging with what was there) and deletes", async () => {
    expect(await run("opendm_list_rules")).toBe("No rules yet.");
    await run("opendm_create_rule", {
      name: "Guide",
      keywords: ["guide"],
      link: "https://example.com/a",
      askEmail: "optional",
      requireFollow: false,
    });
    const [rule] = await workerClient().listRules();

    const updated = await run("opendm_update_rule", { id: rule.id, link: "https://example.com/b", enabled: false });
    expect(updated).toContain("[off]");
    const [after] = await workerClient().listRules();
    expect(after).toMatchObject({ name: "Guide", keywords: ["guide"], link: "https://example.com/b", enabled: false });
    expect(after.flow).toMatchObject({ askEmail: "optional", requireFollow: false });

    expect(await run("opendm_list_rules")).toContain(`#${rule.id}`);
    expect(await run("opendm_delete_rule", { id: rule.id })).toBe(`Deleted rule #${rule.id}.`);
    expect(await run("opendm_list_rules")).toBe("No rules yet.");
    await expect(run("opendm_delete_rule", { id: rule.id })).rejects.toThrow("Rule not found");
  });

  it("no matching rule is reported by the dry run", async () => {
    expect(await run("opendm_test_comment", { comment: "hello" })).toContain("No rule matched.");
  });
});

describe("switches, limits, log, status", () => {
  it("toggles automation and sets the hourly limit", async () => {
    expect(await run("opendm_set_enabled", { enabled: false })).toBe("Automation is now off.");
    expect(await run("opendm_status")).toContain("Automation: off");
    expect(await run("opendm_set_hourly_limit", { hourlyLimit: 40 })).toBe("Hourly limit is now 40.");
    expect(await run("opendm_status")).toContain("0/40 this hour");
    await expect(run("opendm_set_hourly_limit", { hourlyLimit: 0 })).rejects.toThrow();
  });

  it("status points at the webhook URL and says when no account is connected", async () => {
    const out = await run("opendm_status");
    expect(out).toContain("NOT connected");
    expect(out).toContain("https://opendm.test/webhook");
  });

  it("connects an account, subscribes the webhooks and shows the log", async () => {
    const graph = mockGraph();
    expect(await run("opendm_connect_instagram", { token: "IGAAtool-token-0123456789abcdefghij" })).toBe(
      "Connected @shop_account.",
    );
    expect(await run("opendm_status")).toContain("@shop_account (connected)");
    expect(await run("opendm_subscribe_webhooks")).toBe("Subscribed to comments and messages.");
    expect(graph.calls.map((c) => c.url.pathname)).toContain("/v25.0/17841400000000001/subscribed_apps");
    expect(await run("opendm_get_log", { limit: 5 })).toContain("system/info connected @shop_account");
    expect(await run("opendm_get_log", { kind: "dm" })).toBe("No events yet.");
  });

  it("a bad token is reported by the connect tool", async () => {
    const graph = mockGraph();
    graph.on(/\/me/, () =>
      Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 401 }),
    );
    await expect(run("opendm_connect_instagram", { token: "IGAAbad-token-0123456789abcdefghij" })).rejects.toThrow(
      "Invalid OAuth access token",
    );
  });

  it("subscribing without an account explains what to do", async () => {
    await expect(run("opendm_subscribe_webhooks")).rejects.toThrow("Connect an account first");
  });
});

it("every tool has a description Claude can act on", () => {
  expect(tools.map((t) => t.name)).toEqual([
    "opendm_status",
    "opendm_list_rules",
    "opendm_create_rule",
    "opendm_update_rule",
    "opendm_delete_rule",
    "opendm_set_enabled",
    "opendm_test_comment",
    "opendm_get_log",
    "opendm_connect_instagram",
    "opendm_subscribe_webhooks",
    "opendm_set_hourly_limit",
  ]);
  for (const t of tools) expect(t.description.length).toBeGreaterThan(20);
});
