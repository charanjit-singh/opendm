// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Facebook Pages + Messenger, Instagram through Facebook Login, per-rule channels and keyword DMs.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccount } from "../../src/db/accounts";
import { findActiveConversation } from "../../src/db/conversations";
import { recentEvents } from "../../src/db/events";
import {
  addRule,
  commentEvent,
  connect,
  connectPage,
  dmEvent,
  fbCommentEvent,
  fbMessageEvent,
  mockGraph,
  PAGE_ID,
  PAGE_TOKEN,
  postWebhook,
  resetDb,
  testEnv,
} from "../support/helpers";

const FB_USER = "5500110022";

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("Facebook Page comments", () => {
  beforeEach(async () => {
    await connectPage();
  });

  it("private-replies through Messenger and posts the public reply as a comment", async () => {
    await addRule({ channel: "facebook" });
    const g = mockGraph();
    await postWebhook(fbCommentEvent({ id: "fbc1", text: "GUIDE please" }));
    expect(g.sent()).toEqual([
      {
        kind: "private_reply",
        to: "fbc1",
        text: "Hey Sam Rivera! Saw your comment. Want the link? Just reply yes and I'll send it right here.",
      },
      { kind: "public_reply", to: "fbc1", text: "Sent you a DM!" },
    ]);
    const priv = g.calls.find((c) => c.url.pathname.endsWith("/messages"))!;
    expect(priv.url.pathname).toBe(`/v25.0/${PAGE_ID}/messages`);
    expect(priv.body.recipient).toEqual({ comment_id: "fbc1" });
    expect(priv.auth).toBe(`Bearer ${PAGE_TOKEN}`);
    expect(g.calls.find((c) => c.url.pathname.endsWith("/comments"))?.url.pathname).toBe("/v25.0/fbc1/comments");
    const log = await recentEvents(testEnv, 5);
    expect(log.every((e) => e.platform === "facebook")).toBe(true);
  });

  it("walks the whole flow over Messenger: like the Page (trusting 'done'), then the link", async () => {
    await addRule({ channel: "facebook", flow: { requireFollow: true, askEmail: "off" } });
    const g = mockGraph({ name: "Sam Rivera" });
    await postWebhook(fbCommentEvent({ text: "GUIDE" }));
    expect((await findActiveConversation(testEnv, FB_USER))?.platform).toBe("facebook");
    await postWebhook(fbMessageEvent({ text: "yes" }));
    const dms = () => g.sent().filter((s) => s.kind === "dm");
    expect(dms()[0].text).toContain("like our Page Acme Studio on Facebook");
    expect(dms()[0].to).toBe(FB_USER);
    await postWebhook(fbMessageEvent({ text: "done" }));
    expect(dms()[1].text).toContain("https://example.com/guide");
    // Messenger profile lookups ask for names only: Facebook has no follow check.
    const lookup = g.calls.find((c) => c.method === "GET" && c.url.pathname.endsWith(`/${FB_USER}`))!;
    expect(lookup.url.searchParams.get("fields")).toBe("first_name,name");
  });

  it("ignores the Page's own comments, thread replies, other verbs and Messenger echoes", async () => {
    await addRule({ channel: "facebook" });
    const g = mockGraph();
    await postWebhook(fbCommentEvent({ id: "own", from: PAGE_ID }));
    await postWebhook(fbCommentEvent({ id: "reply", parent: "112233445566_998800" }));
    await postWebhook(fbCommentEvent({ id: "edited", verb: "edited" }));
    await postWebhook(fbMessageEvent({ text: "yes", echo: true }));
    expect(g.sent()).toEqual([]);
  });

  it("dedupes retried Facebook webhooks", async () => {
    await addRule({ channel: "facebook" });
    const g = mockGraph();
    await postWebhook(fbCommentEvent({ id: "dup" }));
    await postWebhook(fbCommentEvent({ id: "dup" }));
    expect(g.sent()).toHaveLength(2);
  });

  it("a commenter whose identity Meta hides gets the link in the private reply itself", async () => {
    await addRule({ channel: "facebook" });
    const g = mockGraph();
    await postWebhook(fbCommentEvent({ id: "hidden", from: null }));
    const [priv] = g.sent();
    expect(priv.kind).toBe("private_reply");
    expect(priv.text).toContain("https://example.com/guide");
    expect(await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM conversations").first<{ n: number }>()).toEqual({
      n: 0,
    });
  });

  it("uses the Facebook wording for the follow ask by default", async () => {
    await addRule({ channel: "facebook" });
    const rule = (await testEnv.DB.prepare("SELECT channel FROM rules").first<{ channel: string }>())?.channel;
    expect(rule).toBe("facebook");
  });
});

describe("channels per rule", () => {
  it("an Instagram-only rule does not fire on Facebook, and the other way round", async () => {
    await connect();
    await connectPage();
    await addRule({ name: "ig", keywords: ["INSTAGRAMRULE"], channel: "instagram" });
    await addRule({ name: "fb", keywords: ["FACEBOOKPAGE"], channel: "facebook" });
    await addRule({ name: "both", keywords: ["EVERYWHERE"], channel: "both" });
    const g = mockGraph();
    await postWebhook(fbCommentEvent({ id: "x1", text: "INSTAGRAMRULE" }));
    await postWebhook(commentEvent({ id: "x2", text: "FACEBOOKPAGE" }));
    expect(g.sent()).toEqual([]);
    await postWebhook(commentEvent({ id: "x3", text: "INSTAGRAMRULE" }));
    await postWebhook(fbCommentEvent({ id: "x4", text: "FACEBOOKPAGE", from: "u-fb" }));
    await postWebhook(fbCommentEvent({ id: "x5", text: "EVERYWHERE", from: "u-fb2" }));
    await postWebhook(commentEvent({ id: "x6", text: "EVERYWHERE", from: "u-ig2" }));
    const priv = g.sent().filter((s) => s.kind === "private_reply");
    expect(priv.map((p) => p.to)).toEqual(["x3", "x4", "x5", "x6"]);
  });

  it("logs a clear error when the platform is not connected", async () => {
    await connect();
    await addRule({ channel: "both" });
    const g = mockGraph();
    await postWebhook(fbCommentEvent({ text: "GUIDE" }));
    expect(g.sent()).toEqual([]);
    expect((await recentEvents(testEnv, 1))[0]).toMatchObject({
      status: "error",
      error: "no facebook account connected",
      platform: "facebook",
    });
  });
});

describe("Instagram through Facebook Login (Page token)", () => {
  beforeEach(async () => {
    await connectPage({ igId: "17841400000000001", igUsername: "acme_ig" });
  });

  it("resolves the Instagram account from the Page and sends with the Page token via /{page-id}/messages", async () => {
    expect(await getAccount(testEnv, "instagram")).toMatchObject({
      mode: "facebook_login",
      token: PAGE_TOKEN,
      ownerId: PAGE_ID,
      accountId: "17841400000000001",
      username: "acme_ig",
    });
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ id: "igfb1", text: "GUIDE" }));
    const priv = g.calls.find((c) => c.url.pathname.endsWith("/messages"))!;
    expect(priv.url.pathname).toBe(`/v25.0/${PAGE_ID}/messages`);
    expect(priv.auth).toBe(`Bearer ${PAGE_TOKEN}`);
    // Instagram public replies stay on the /replies edge.
    expect(g.calls.some((c) => c.url.pathname === "/v25.0/igfb1/replies")).toBe(true);
  });

  it("an Instagram Login connection wins when both exist", async () => {
    await connect();
    expect((await getAccount(testEnv, "instagram"))?.mode).toBe("instagram_login");
    expect((await getAccount(testEnv, "facebook"))?.mode).toBe("facebook_login");
  });
});

describe("keyword direct messages", () => {
  it("start a flow on Instagram and Messenger when the rule listens for them, skipping the opener", async () => {
    await connect();
    await connectPage();
    await addRule({ channel: "both", dm_trigger: true, flow: { requireFollow: false, askEmail: "off" } });
    const g = mockGraph();
    await postWebhook(dmEvent({ text: "guide please", from: "ig-u" }));
    await postWebhook(fbMessageEvent({ text: "GUIDE", from: "fb-u" }));
    const dms = g.sent().filter((s) => s.kind === "dm");
    expect(dms.map((d) => d.to)).toEqual(["ig-u", "fb-u"]);
    expect(dms.every((d) => d.text.includes("https://example.com/guide"))).toBe(true);
  });

  it("with a follow gate the first reply is the follow ask, and the conversation continues", async () => {
    await connect();
    await addRule({ dm_trigger: true, flow: { requireFollow: true, askEmail: "off" } });
    const g = mockGraph({ following: true });
    await postWebhook(dmEvent({ text: "GUIDE", from: "ig-u" }));
    expect(g.sent()[0].text).toContain("follow @shop_account");
    await postWebhook(dmEvent({ text: "done", from: "ig-u" }));
    expect(g.sent()[1].text).toContain("https://example.com/guide");
  });

  it("are ignored when the rule does not opt in, or the text has no keyword", async () => {
    await connect();
    await addRule({ dm_trigger: false });
    await addRule({ name: "other", keywords: ["OTHER"], dm_trigger: true });
    const g = mockGraph();
    await postWebhook(dmEvent({ text: "GUIDE", from: "u1" }));
    await postWebhook(dmEvent({ text: "hello", from: "u2" }));
    expect(g.sent()).toEqual([]);
  });

  it("do not fire while automation is off", async () => {
    await connect();
    await addRule({ dm_trigger: true });
    await testEnv.DB.prepare("INSERT INTO settings (key, value, updated) VALUES ('enabled', '0', 0)").run();
    const g = mockGraph();
    await postWebhook(dmEvent({ text: "GUIDE", from: "u1" }));
    expect(g.sent()).toEqual([]);
  });
});
