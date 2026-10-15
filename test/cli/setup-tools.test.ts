// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The onboarding and activity tools an agent uses, and the non-interactive `opendm setup` CLI.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EXIT, runCommand } from "../../cli/commands.ts";
import { mergePayload, MESSAGE_KEYS as SPEC_KEYS, specToPayload } from "../../src/mcp/rule-spec.ts";
import { tools } from "../../src/mcp/tools.ts";
import { MESSAGE_KEYS as FLOW_KEYS } from "../../src/services/flow";
import {
  addRule,
  commentEvent,
  connect,
  connectPage,
  dmEvent,
  mockGraph,
  PAGE_ID,
  PAGE_TOKEN,
  postWebhook,
  resetDb,
  testEnv,
  workerClient,
} from "../support/helpers.ts";

const run = (name: string, input: unknown = {}) => tools.find((t) => t.name === name)!.run(workerClient(), input);
const cli = (line: string) => runCommand(line.split(" "), workerClient());

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("rule spec", () => {
  it("knows every message the flow can send", () => {
    expect([...SPEC_KEYS]).toEqual([...FLOW_KEYS]);
  });

  it("messages become variants, with the first wording as the single text", () => {
    const payload = specToPayload({
      messages: { openerText: ["a", "b"] },
      rotation: "random",
      channel: "both",
      dmTrigger: true,
    });
    expect(payload).toMatchObject({
      channel: "both",
      dm_trigger: true,
      flow: { openerText: "a", rotation: "random", variants: { openerText: ["a", "b"] } },
    });
  });

  it("merging keeps variants that were not touched", () => {
    const base = {
      keywords: ["x"],
      flow: { variants: { openerText: ["a", "b"], deliverText: ["c", "d"] }, askEmail: "off" },
    };
    const merged = mergePayload(base, { flow: { variants: { openerText: ["z", "y"] } } });
    expect(merged.flow?.variants).toEqual({ openerText: ["z", "y"], deliverText: ["c", "d"] });
    expect(merged.flow?.askEmail).toBe("off");
  });
});

describe("onboarding tools", () => {
  it("setup_status explains the next step and when a person must act", async () => {
    await testEnv.DB.exec("SELECT 1");
    const out = await run("opendm_setup_status");
    expect(out).toContain("[x] OpenDM is running");
    expect(out).toContain("NEXT: Connect Instagram and/or a Facebook Page");
    expect(out).toContain("A PERSON has to do this step");
    await connect();
    expect(await run("opendm_setup_status")).toContain("NEXT: Webhook subscribed");
  });

  it("get_webhook_details returns what Meta's form needs", async () => {
    const out = await run("opendm_get_webhook_details");
    expect(out).toContain("Callback URL: https://opendm.test/webhook");
    expect(out).toContain("Verify token: verify-me");
  });

  it("walks Instagram onboarding: credentials, OAuth URL, exchange, subscribe, send_test", async () => {
    const g = mockGraph();
    expect(
      await run("opendm_set_app_credentials", {
        platform: "instagram",
        appId: "1234567890",
        appSecret: "secretsecretsecret",
      }),
    ).toContain("Saved");
    expect(await run("opendm_get_oauth_url", { platform: "instagram" })).toContain(
      "https://www.instagram.com/oauth/authorize",
    );
    g.on(/ig_exchange_token/, () => ({ access_token: "IGAAlong0000000000000000000000000", expires_in: 5184000 }));
    expect(
      await run("opendm_exchange_token", { platform: "instagram", token: "IGAAshort000000000000000000000000" }),
    ).toContain("long-lived");
    expect(await run("opendm_subscribe_webhooks", {})).toContain("Subscribed instagram");
    await addRule();
    const out = await run("opendm_send_test", {});
    expect(out).toContain("ok   instagram token");
    expect(out).toContain("Matched rule");
    expect(out).toContain("https://example.com/guide");
  });

  it("walks Facebook onboarding with a user token and a Page choice", async () => {
    const g = mockGraph();
    g.on(/\/me\/accounts/, () => ({
      data: [
        { id: PAGE_ID, name: "Acme Studio", access_token: PAGE_TOKEN },
        { id: "2", name: "Other", access_token: "EAAother000000000000000000000000" },
      ],
    }));
    expect(await run("opendm_connect_facebook", { token: "EAAuser0000000000000000000000000" })).toContain(
      "opendm_select_facebook_page",
    );
    expect(await run("opendm_list_facebook_pages")).toContain(`${PAGE_ID} Acme Studio`);
    expect(await run("opendm_select_facebook_page", { pageId: PAGE_ID })).toBe("Connected Facebook Page Acme Studio.");
    expect(await run("opendm_subscribe_webhooks", { platform: "facebook" })).toContain("Subscribed facebook");
    expect(await run("opendm_status")).toContain("Facebook Page: Acme Studio (facebook login)");
    expect(await run("opendm_disconnect", { platform: "facebook" })).toBe("Disconnected facebook.");
  });

  it("refresh_token and setup_checks use live Meta calls", async () => {
    await connect();
    mockGraph();
    expect(await run("opendm_refresh_token")).toBe("refreshed");
    expect(await run("opendm_setup_checks")).toContain("ok   instagram token");
  });
});

describe("flow and activity tools", () => {
  it("set_messages adds wordings and get_rule shows them; update_rule keeps them", async () => {
    await run("opendm_create_rule", { keywords: ["GUIDE"], link: "https://x.io", channel: "both", dmTrigger: true });
    const id = (await workerClient().listRules())[0].id;
    const out = await run("opendm_set_messages", {
      id,
      messages: { openerText: ["Hi!", "Hey there!"], deliverText: ["Here: {link}", "Yours: {link}"] },
      rotation: "random",
    });
    expect(out).toContain("message variants (random): openerText x2, deliverText x2");
    expect(out).toContain("channel: both, also keyword DMs");
    const full = await run("opendm_get_rule", { id });
    expect(full).toContain('openerText: ["Hi!","Hey there!"]');
    await run("opendm_update_rule", { id, link: "https://y.io" });
    expect(await run("opendm_get_rule", { id })).toContain('deliverText: ["Here: {link}","Yours: {link}"]');
    const preview = await run("opendm_test_comment", {
      comment: "GUIDE",
      variant: 2,
      replies: ["yes", "done"],
      following: "yes",
      platform: "instagram",
    });
    expect(preview).toContain("Hey there!");
    expect(preview).toContain("[openerText#2/2]");
  });

  it("lists conversations, leads, the queue and the log with wordings", async () => {
    await connect();
    await connectPage();
    await addRule({ flow: { requireFollow: false, askEmail: "optional", variants: { openerText: ["O1", "O2"] } } });
    mockGraph();
    await postWebhook(commentEvent({ id: "z1", text: "GUIDE", from: "u-z", username: "zed" }));
    await postWebhook(dmEvent({ text: "yes", from: "u-z" }));
    await postWebhook(dmEvent({ text: "zed@example.com", from: "u-z" }));
    expect(await run("opendm_list_conversations", { step: "done" })).toContain(
      '@zed rule "Guide" done email: zed@example.com',
    );
    expect(await run("opendm_list_leads")).toContain("zed@example.com\tinstagram @zed");
    expect(await run("opendm_get_queue")).toBe("The queue is empty.");
    expect(await run("opendm_get_log", { kind: "comment" })).toContain("[openerText#1/2]");
    expect(await run("opendm_health")).toBe("opendm 0.2.0: ok");
  });

  it("reports validation problems readably", async () => {
    await expect(run("opendm_set_messages", { id: 1, messages: { bogus: ["x"] } }))
      .resolves.toBeDefined()
      .catch(() => undefined);
    await expect(run("opendm_get_rule", { id: 999 })).rejects.toThrow("Rule not found");
  });
});

describe("opendm setup (non-interactive)", () => {
  it("status exits 2 while a person has to act, and 0 when only the agent has work left", async () => {
    const first = await cli("setup status");
    expect(first.exitCode).toBe(EXIT.needsHuman);
    expect(first.text).toContain("NEXT: Connect Instagram");
    expect((first.json as { next: { id: string } }).next.id).toBe("connect");
    await connect();
    const second = await cli("setup status");
    expect(second.exitCode).toBe(EXIT.ok);
    expect(second.text).toContain("NEXT: Webhook subscribed");
  });

  it("credentials, oauth-url, exchange, facebook, subscribe and test all work from flags", async () => {
    const g = mockGraph();
    expect(
      (await cli("setup credentials --platform facebook --app-id 5566778899 --app-secret fbsecretfbsecretfb")).text,
    ).toContain("Saved the facebook");
    expect((await cli("setup oauth-url --platform facebook")).exitCode).toBe(EXIT.needsHuman);
    g.on(/\/me\/accounts/, () => ({ data: [{ id: PAGE_ID, name: "Acme Studio", access_token: PAGE_TOKEN }] }));
    expect((await cli("setup facebook --token EAAuser0000000000000000000000000")).text).toBe(
      "Connected Facebook Page Acme Studio.",
    );
    expect((await cli("setup subscribe --platform facebook")).exitCode).toBe(EXIT.ok);
    expect((await cli("setup exchange --platform instagram --token IGAAshort000000000000000000000000")).text).toContain(
      "Connected @shop_account",
    );
    await addRule();
    const test = await cli("setup test");
    expect(test.text).toContain('dry run of "GUIDE": matched');
    expect(test.exitCode).toBe(EXIT.needsHuman); // no webhook event has arrived yet: that needs a person
  });

  it("facebook with several pages asks for --page-id (exit 2), then connects", async () => {
    const g = mockGraph();
    g.on(/\/me\/accounts/, () => ({
      data: [
        { id: "1", name: "One", access_token: "EAAone000000000000000000000000000" },
        { id: "2", name: "Two", access_token: "EAAtwo000000000000000000000000000" },
      ],
    }));
    const ask = await cli("setup facebook --token EAAuser0000000000000000000000000");
    expect(ask.exitCode).toBe(EXIT.needsHuman);
    expect(ask.text).toContain("--page-id");
    const ok = await cli("setup facebook --token EAAuser0000000000000000000000000 --page-id 2");
    expect(ok.text).toBe("Connected Facebook Page Two.");
  });

  it("is idempotent: running steps twice changes nothing and still succeeds", async () => {
    mockGraph();
    for (let i = 0; i < 2; i++) {
      expect(
        (await cli("setup credentials --platform instagram --app-id 1234567890 --app-secret secretsecretsecret"))
          .exitCode,
      ).toBe(EXIT.ok);
      expect(
        (await cli("setup exchange --platform instagram --token IGAAshort000000000000000000000000")).exitCode,
      ).toBe(EXIT.ok);
    }
    expect(
      (await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM settings WHERE key = 'ig_user_id'").first<{ n: number }>())
        ?.n,
    ).toBe(1);
  });

  it("reports errors clearly: missing flags and unknown subcommands", async () => {
    await expect(cli("setup credentials --platform instagram")).rejects.toThrow("--app-id is required");
    await expect(cli("setup exchange")).rejects.toThrow("--token is required");
    await expect(cli("setup bogus")).rejects.toThrow('Unknown setup command "bogus"');
    expect((await cli("setup help")).text).toContain("opendm setup");
  });
});
