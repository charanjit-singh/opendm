// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recentEvents } from "../../src/db/events";
import { setSetting } from "../../src/db/settings";
import {
  addRule,
  commentEvent,
  connect,
  dmEvent,
  IG_ID,
  mockGraph,
  postWebhook,
  request,
  resetDb,
  TOKEN,
  testEnv,
} from "../support/helpers";

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("GET /webhook (Meta verification handshake)", () => {
  const q = (o: Record<string, string>) => `/webhook?${new URLSearchParams(o)}`;
  it("echoes the challenge when the verify token matches", async () => {
    const res = await request(
      q({ "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "1158201444" }),
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("1158201444");
  });
  it("refuses a wrong token, a wrong mode and a missing token", async () => {
    expect(
      (await request(q({ "hub.mode": "subscribe", "hub.verify_token": "nope", "hub.challenge": "1" }))).status,
    ).toBe(403);
    expect(
      (await request(q({ "hub.mode": "unsubscribe", "hub.verify_token": "verify-me", "hub.challenge": "1" }))).status,
    ).toBe(403);
    expect((await request(q({ "hub.mode": "subscribe", "hub.challenge": "1" }))).status).toBe(403);
  });
});

describe("POST /webhook signature", () => {
  it("rejects a missing, a wrong and a forged signature, and does nothing", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    const ev = commentEvent({ text: "GUIDE" });
    expect((await postWebhook(ev, { signature: null })).status).toBe(401);
    expect((await postWebhook(ev, { signature: `sha256=${"ab".repeat(32)}` })).status).toBe(401);
    expect((await postWebhook(ev, { secret: "not-the-app-secret" })).status).toBe(401);
    expect(g.sent()).toEqual([]);
    expect(await recentEvents(testEnv, 10)).toEqual([]);
  });
  it("accepts a valid signature and answers 200 quickly", async () => {
    mockGraph();
    const res = await postWebhook({ object: "instagram", entry: [] });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("EVENT_RECEIVED");
  });
  it("answers 400 on a signed body that is not JSON", async () => {
    const { sign } = await import("../../src/lib/crypto");
    const body = "not json";
    const res = await request("/webhook", {
      method: "POST",
      body,
      headers: { "X-Hub-Signature-256": await sign(testEnv.INSTAGRAM_APP_SECRET, body) },
    });
    expect(res.status).toBe(400);
  });
});

describe("comment -> private reply + public reply", () => {
  it("sends the opener as a private reply and a public comment reply", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ id: "c1", text: "GUIDE please!", username: "sam" }));
    expect(g.sent()).toEqual([
      {
        kind: "private_reply",
        to: "c1",
        text: "Hey sam! Saw your comment. Want the link? Just reply yes and I'll send it right here.",
      },
      { kind: "public_reply", to: "c1", text: "Sent you a DM!" },
    ]);
    const priv = g.calls.find((c) => c.url.pathname.endsWith("/messages"))!;
    expect(priv.url.origin + priv.url.pathname).toBe(`https://graph.test/v25.0/${IG_ID}/messages`);
    expect(priv.body.recipient).toEqual({ comment_id: "c1" });
    expect(priv.auth).toBe(`Bearer ${TOKEN}`);
  });

  it("sends the link directly when the rule has no opener and no gates", async () => {
    await connect();
    await addRule({ flow: { opener: false, requireFollow: false, askEmail: "off" } });
    const g = mockGraph();
    await postWebhook(commentEvent({ text: "guide" }));
    expect(g.sent()[0].text).toContain("https://example.com/guide");
  });

  it("matches typos and logs the event with the keyword", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ text: "gude" }));
    expect(g.sent()).toHaveLength(2);
    const log = await recentEvents(testEnv, 10);
    expect(log.some((e: any) => e.status === "sent" && e.keyword === "GUIDE")).toBe(true);
  });

  it("dedupes: Meta retrying the same comment sends nothing twice", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ id: "dup", text: "GUIDE" }));
    await postWebhook(commentEvent({ id: "dup", text: "GUIDE" }));
    expect(g.sent()).toHaveLength(2);
  });

  it("ignores comments with no keyword (and logs why)", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ text: "great post!" }));
    expect(g.sent()).toEqual([]);
    expect((await recentEvents(testEnv, 1))[0]).toMatchObject({ status: "skipped", error: "no keyword matched" });
  });

  it("ignores the account's own comments and replies in a thread", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ id: "own", text: "GUIDE", from: IG_ID }));
    await postWebhook(commentEvent({ id: "thread", text: "GUIDE", parent: "c0" }));
    expect(g.sent()).toEqual([]);
  });

  it("honours the post filter", async () => {
    await connect();
    await addRule({ media_id: "only-this-post" });
    const g = mockGraph();
    await postWebhook(commentEvent({ id: "a", text: "GUIDE", media: "another-post" }));
    expect(g.sent()).toEqual([]);
    await postWebhook(commentEvent({ id: "b", text: "GUIDE", media: "only-this-post" }));
    expect(g.sent()).toHaveLength(2);
  });

  it("does nothing while the automation switch is off", async () => {
    await connect();
    await addRule();
    await setSetting(testEnv, "enabled", "0");
    const g = mockGraph();
    await postWebhook(commentEvent({ text: "GUIDE" }));
    expect(g.sent()).toEqual([]);
    expect((await recentEvents(testEnv, 1))[0].error).toBe("automation is switched off");
  });

  it("logs an error (and sends nothing) when no account is connected", async () => {
    await addRule();
    const g = mockGraph();
    await postWebhook(commentEvent({ text: "GUIDE" }));
    expect(g.sent()).toEqual([]);
    expect((await recentEvents(testEnv, 1))[0]).toMatchObject({
      status: "error",
      error: "no Instagram account connected",
    });
  });

  it("does not post the public reply when the private reply failed", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    g.on(/\/messages$/, () => Response.json({ error: { message: "(#10) Cannot reply", code: 10 } }, { status: 400 }));
    await postWebhook(commentEvent({ text: "GUIDE" }));
    expect(g.sent().filter((s) => s.kind === "public_reply")).toEqual([]);
    expect(
      (await recentEvents(testEnv, 5)).some((e: any) => e.status === "error" && e.error.startsWith("permission:")),
    ).toBe(true);
  });

  it("rotates the public reply lines", async () => {
    await connect();
    await addRule({ public_replies: ["one", "two"] });
    const g = mockGraph();
    for (const id of ["r1", "r2", "r3", "r4"]) await postWebhook(commentEvent({ id, text: "GUIDE", from: `u${id}` }));
    const pubs = g
      .sent()
      .filter((s) => s.kind === "public_reply")
      .map((s) => s.text);
    for (let i = 1; i < pubs.length; i++) expect(pubs[i]).not.toBe(pubs[i - 1]);
  });
});

describe("DM handling", () => {
  it("ignores echoes of our own messages and strangers with no conversation", async () => {
    await connect();
    await addRule();
    const g = mockGraph();
    await postWebhook(dmEvent({ text: "yes", echo: true }));
    await postWebhook(dmEvent({ text: "hello", from: "stranger" }));
    expect(g.sent()).toEqual([]);
  });
});
