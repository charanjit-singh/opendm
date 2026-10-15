// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Onboarding: app credentials, OAuth for both logins, token exchange, Facebook Page selection, subscriptions, live checks.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAccount } from "../../src/db/accounts";
import { getAppCredentials } from "../../src/db/app-credentials";
import { getSetting } from "../../src/db/settings";
import { sign } from "../../src/lib/crypto";
import { refreshTokenIfNeeded } from "../../src/services/token-refresh";
import {
  addRule,
  api,
  commentEvent,
  connect,
  connectPage,
  IG_ID,
  login,
  mockGraph,
  PAGE_ID,
  PAGE_TOKEN,
  postWebhook,
  request,
  resetDb,
  testEnv,
} from "../support/helpers";

let cookie: string;
beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
  cookie = (await login()).cookie;
});

const step = async (id: string) =>
  (await api(cookie, "GET", "/api/setup")).data.steps.find((s: { id: string }) => s.id === id);

describe("setup checklist", () => {
  it("starts with the account missing and points at the next step, flagging what a person must do", async () => {
    const { data } = await api(cookie, "GET", "/api/setup");
    expect(data.ready).toBe(false);
    expect(data.steps.map((s: { id: string }) => s.id)).toEqual([
      "server",
      "app",
      "connect",
      "token",
      "webhook",
      "events",
      "rule",
      "comment",
      "review",
    ]);
    expect(data.next.id).toBe("connect");
    expect(data.next.needsHuman).toBe(true);
    expect((await step("server")).status).toBe("ok");
  });

  it("each step turns green as the work gets done", async () => {
    expect((await step("app")).status).toBe("ok"); // the test env has the Instagram app id + secret
    expect((await step("connect")).status).toBe("todo");
    await connect();
    expect((await step("connect")).status).toBe("ok");
    expect((await step("token")).status).toBe("ok");
    expect((await step("webhook")).status).toBe("todo");
    mockGraph();
    await api(cookie, "POST", "/api/subscribe", { platform: "instagram" });
    expect((await step("webhook")).status).toBe("ok");
    expect((await step("rule")).status).toBe("todo");
    await addRule();
    expect((await step("rule")).status).toBe("ok");
    expect((await step("events")).status).toBe("todo");
    await postWebhook(commentEvent({ text: "GUIDE" }));
    expect((await step("events")).status).toBe("ok");
    expect((await step("comment")).status).toBe("ok");
    const { data } = await api(cookie, "GET", "/api/setup");
    expect(data.ready).toBe(true);
    expect(data.next).toBeNull();
  });

  it("a token error turns the token step into a warning", async () => {
    await connect();
    await testEnv.DB.prepare(
      "INSERT INTO settings (key, value, updated) VALUES ('token_error', 'Invalid OAuth access token', 0)",
    ).run();
    expect(await step("token")).toMatchObject({
      status: "warn",
      detail: "Invalid OAuth access token",
      needsHuman: true,
    });
  });

  it("requires login", async () => {
    expect((await request("/api/setup")).status).toBe(401);
  });
});

describe("app credentials", () => {
  it("stores the secret encrypted, and webhooks are then verified with it", async () => {
    const { res } = await api(cookie, "POST", "/api/setup/credentials", {
      platform: "facebook",
      appId: "9988776655",
      appSecret: "fb-app-secret-123456",
    });
    expect(res.status).toBe(200);
    expect(await getSetting(testEnv, "app_secret_facebook")).not.toContain("fb-app-secret");
    expect(await getAppCredentials(testEnv, "facebook")).toEqual({ id: "9988776655", secret: "fb-app-secret-123456" });
    await connect();
    await addRule();
    const g = mockGraph();
    const body = JSON.stringify(commentEvent({ text: "GUIDE" }));
    const ok = await request("/webhook", {
      method: "POST",
      body,
      headers: { "X-Hub-Signature-256": await sign("fb-app-secret-123456", body) },
    });
    expect(ok.status).toBe(200);
    expect(g.sent().length).toBeGreaterThan(0);
    // The Instagram app's own secret still works, and a stranger's does not.
    const other = await request("/webhook", {
      method: "POST",
      body,
      headers: { "X-Hub-Signature-256": await sign("nobody", body) },
    });
    expect(other.status).toBe(401);
  });

  it("validates input", async () => {
    expect(
      (await api(cookie, "POST", "/api/setup/credentials", { platform: "instagram", appId: "1" })).res.status,
    ).toBe(400);
    expect(
      (await api(cookie, "POST", "/api/setup/credentials", { platform: "myspace", appId: "123456" })).res.status,
    ).toBe(400);
  });
});

describe("OAuth URLs", () => {
  it("builds the Instagram and Facebook authorize URLs with the right permissions and a signed state", async () => {
    const ig = new URL((await api(cookie, "GET", "/api/setup/oauth-url?platform=instagram")).data.url);
    expect(ig.origin + ig.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(ig.searchParams.get("scope")).toBe(
      "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
    );
    expect(ig.searchParams.get("redirect_uri")).toBe("https://opendm.test/admin/oauth/callback");

    await api(cookie, "POST", "/api/setup/credentials", { platform: "facebook", appId: "4455667788" });
    const fb = new URL((await api(cookie, "GET", "/api/setup/oauth-url?platform=facebook")).data.url);
    expect(fb.origin + fb.pathname).toBe("https://www.facebook.com/dialog/oauth");
    expect(fb.searchParams.get("client_id")).toBe("4455667788");
    for (const scope of [
      "pages_show_list",
      "pages_manage_metadata",
      "pages_messaging",
      "pages_read_engagement",
      "pages_manage_engagement",
    ]) {
      expect(fb.searchParams.get("scope")).toContain(scope);
    }
    expect(fb.searchParams.get("state")).toBeTruthy();
  });

  it("explains when the app id is missing", async () => {
    const { res, data } = await api(cookie, "GET", "/api/setup/oauth-url?platform=facebook");
    expect(res.status).toBe(400);
    expect(data.error).toContain("app ID");
  });

  it("Facebook callback: code -> user token -> long-lived -> the Page is connected", async () => {
    await api(cookie, "POST", "/api/setup/credentials", {
      platform: "facebook",
      appId: "4455667788",
      appSecret: "fb-secret-abcdefgh",
    });
    const g = mockGraph();
    g.on(/oauth\/access_token\?.*code=/, () => ({
      access_token: "EAAshortuser0000000000000000000000",
      expires_in: 3600,
    }));
    g.on(/oauth\/access_token\?.*fb_exchange_token/, () => ({
      access_token: "EAAlonguser00000000000000000000000",
      expires_in: 5184000,
    }));
    g.on(/\/me\/accounts/, () => ({
      data: [
        {
          id: PAGE_ID,
          name: "Acme Studio",
          access_token: PAGE_TOKEN,
          instagram_business_account: { id: "17841400000000001", username: "acme_ig" },
        },
      ],
    }));
    const state = new URL(
      (await api(cookie, "GET", "/api/setup/oauth-url?platform=facebook")).data.url,
    ).searchParams.get("state")!;
    const res = await request(`/admin/oauth/callback?code=AQDfb&state=${encodeURIComponent(state)}`, {
      headers: { Cookie: cookie },
      redirect: "manual",
    });
    expect(decodeURIComponent(res.headers.get("Location")!)).toContain("Connected Facebook Page Acme Studio");
    expect(await getAccount(testEnv, "facebook")).toMatchObject({
      token: PAGE_TOKEN,
      ownerId: PAGE_ID,
      username: "Acme Studio",
    });
    expect((await getAccount(testEnv, "instagram"))?.mode).toBe("facebook_login");
    const exchange = g.calls.find((c) => /fb_exchange_token/.test(c.url.search))!;
    expect(exchange.url.searchParams.get("client_id")).toBe("4455667788");
    expect(exchange.url.searchParams.get("fb_exchange_token")).toBe("EAAshortuser0000000000000000000000");
  });
});

describe("token exchange", () => {
  it("Instagram: upgrades a short-lived token to a long-lived one and connects", async () => {
    const g = mockGraph();
    g.on(/access_token\?grant_type=ig_exchange_token/, () => ({
      access_token: "IGAAlonglived0000000000000000000000",
      token_type: "bearer",
      expires_in: 5184000,
    }));
    const { data } = await api(cookie, "POST", "/api/setup/exchange", {
      platform: "instagram",
      token: "IGAAshortlived00000000000000000000",
    });
    expect(data.message).toContain("Connected @shop_account (long-lived token");
    expect(await getAccount(testEnv, "instagram")).toMatchObject({
      token: "IGAAlonglived0000000000000000000000",
      accountId: IG_ID,
    });
    expect(Number(await getSetting(testEnv, "token_expires"))).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });

  it("Instagram: keeps a token that cannot be upgraded", async () => {
    const g = mockGraph();
    g.on(/ig_exchange_token/, () =>
      Response.json({ error: { message: "already long-lived", code: 100 } }, { status: 400 }),
    );
    await api(cookie, "POST", "/api/setup/exchange", {
      platform: "instagram",
      token: "IGAAkeepasis00000000000000000000",
    });
    expect((await getAccount(testEnv, "instagram"))?.token).toBe("IGAAkeepasis00000000000000000000");
  });

  it("rejects a token Instagram does not accept", async () => {
    const g = mockGraph();
    g.on(/\/me/, () =>
      Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 401 }),
    );
    const { res, data } = await api(cookie, "POST", "/api/setup/exchange", {
      platform: "instagram",
      token: "IGAAbadbadbadbadbadbadbadbad",
    });
    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid OAuth access token");
  });
});

describe("Facebook Page connection", () => {
  const pages = [
    {
      id: PAGE_ID,
      name: "Acme Studio",
      access_token: PAGE_TOKEN,
      instagram_business_account: { id: "17841400000000001", username: "acme_ig" },
    },
    { id: "998877", name: "Second Page", access_token: "EAAsecondpagetoken00000000000000000" },
  ];

  it("a Page token connects straight away and links the Instagram account", async () => {
    const g = mockGraph();
    g.on(/\/me\/accounts/, () =>
      Response.json({ error: { message: "(#100) not a user token", code: 100 } }, { status: 400 }),
    );
    g.on(/\/me\?fields=id,name/, () => ({
      id: PAGE_ID,
      name: "Acme Studio",
      instagram_business_account: { id: "17841400000000001", username: "acme_ig" },
    }));
    const { data } = await api(cookie, "POST", "/api/facebook/connect", { token: PAGE_TOKEN });
    expect(data).toMatchObject({ connected: true, page: { id: PAGE_ID, name: "Acme Studio" } });
    expect(await getAccount(testEnv, "facebook")).toMatchObject({ token: PAGE_TOKEN, ownerId: PAGE_ID });
    expect(await getSetting(testEnv, "fb_token")).not.toContain("EAAF");
  });

  it("a user token with several Pages asks which one, then connects the chosen Page", async () => {
    const g = mockGraph();
    g.on(/\/me\/accounts/, () => ({ data: pages }));
    const first = await api(cookie, "POST", "/api/facebook/connect", { token: "EAAuserusertoken000000000000000000" });
    expect(first.data).toMatchObject({ connected: false, needsPage: true });
    expect(first.data.pages.map((p: { id: string }) => p.id)).toEqual([PAGE_ID, "998877"]);
    expect(await getAccount(testEnv, "facebook")).toBeNull();
    expect((await api(cookie, "GET", "/api/facebook/pages")).data.pages).toHaveLength(2);

    const chosen = await api(cookie, "POST", "/api/facebook/select", { pageId: "998877" });
    expect(chosen.data.connected).toBe(true);
    expect(await getAccount(testEnv, "facebook")).toMatchObject({
      ownerId: "998877",
      token: "EAAsecondpagetoken00000000000000000",
    });
    expect(await getSetting(testEnv, "fb_user_token")).toBeNull();
  });

  it("a user token with one Page connects it directly; an unknown Page is refused", async () => {
    const g = mockGraph();
    g.on(/\/me\/accounts/, () => ({ data: [pages[0]] }));
    expect(
      (await api(cookie, "POST", "/api/facebook/connect", { token: "EAAuserusertoken000000000000000000" })).data
        .connected,
    ).toBe(true);
    const bad = await api(cookie, "POST", "/api/facebook/connect", {
      token: "EAAuserusertoken000000000000000000",
      pageId: "nope",
    });
    expect(bad.data).toMatchObject({ connected: false, needsPage: true });
    expect((await api(cookie, "POST", "/api/facebook/select", { pageId: "nope" })).res.status).toBe(404);
  });

  it("rejects a token Facebook does not accept, and asking for pages before connecting", async () => {
    const g = mockGraph();
    g.on(/\/me/, () =>
      Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 401 }),
    );
    expect(
      (await api(cookie, "POST", "/api/facebook/connect", { token: "EAAbadbadbadbadbadbadbadbadbad" })).res.status,
    ).toBe(400);
    expect((await api(cookie, "GET", "/api/facebook/pages")).res.status).toBe(400);
  });

  it("subscribes the Page to feed, messages and postbacks, and can be disconnected", async () => {
    await connectPage();
    const g = mockGraph();
    expect((await api(cookie, "POST", "/api/subscribe", { platform: "facebook" })).data).toEqual({
      subscribed: true,
      platform: "facebook",
    });
    const call = g.calls.find((c) => c.url.pathname.endsWith("/subscribed_apps"))!;
    expect(call.url.pathname).toBe(`/v25.0/${PAGE_ID}/subscribed_apps`);
    expect(call.url.searchParams.get("subscribed_fields")).toBe("feed,messages,messaging_postbacks");
    expect(call.auth).toBe(`Bearer ${PAGE_TOKEN}`);
    await api(cookie, "POST", "/api/disconnect", { platform: "facebook" });
    expect(await getAccount(testEnv, "facebook")).toBeNull();
  });

  it("status shows both channels", async () => {
    await connect();
    await connectPage({ igId: "x" });
    const { channels } = (await api(cookie, "GET", "/api/status")).data;
    expect(channels.instagram).toMatchObject({ connected: true, mode: "instagram_login", name: "shop_account" });
    expect(channels.facebook).toMatchObject({ connected: true, mode: "facebook_login", name: "Acme Studio" });
  });
});

describe("live checks and refresh", () => {
  it("reports each token, the subscribed fields and whether events arrived", async () => {
    await connect();
    await connectPage();
    mockGraph();
    const { checks } = (await api(cookie, "GET", "/api/setup/checks")).data;
    const byName = Object.fromEntries(checks.map((c: { name: string; ok: boolean; detail: string }) => [c.name, c]));
    expect(byName["instagram token"]).toMatchObject({ ok: true });
    expect(byName["instagram webhook subscription"].detail).toContain("comments, messages");
    expect(byName["facebook token"].ok).toBe(true);
    expect(byName["webhook events"].ok).toBe(false);
  });

  it("flags a token Meta rejects", async () => {
    await connect();
    const g = mockGraph();
    g.on(/\/me\?/, () => Response.json({ error: { message: "Session expired", code: 190 } }, { status: 401 }));
    const { checks } = (await api(cookie, "GET", "/api/setup/checks")).data;
    expect(checks.find((c: { name: string }) => c.name === "instagram token")).toMatchObject({
      ok: false,
      detail: "Session expired",
    });
  });

  it("forces a token refresh on request", async () => {
    await connect();
    const g = mockGraph();
    const { data } = await api(cookie, "POST", "/api/token/refresh", {});
    expect(data.result).toBe("refreshed");
    expect(g.calls[0].url.pathname).toBe("/refresh_access_token");
    expect(await refreshTokenIfNeeded(testEnv)).toBe("refreshed in the last day");
  });

  it("does not try to refresh a Facebook Login token (Page tokens do not expire)", async () => {
    await connectPage({ igId: "17841400000000001" });
    expect(await refreshTokenIfNeeded(testEnv)).toContain("no Instagram Login token");
  });
});

describe("activity endpoints", () => {
  it("lists conversations, leads (emails) and the send queue", async () => {
    await connect();
    await addRule({ flow: { requireFollow: false, askEmail: "optional" } });
    mockGraph();
    await postWebhook(commentEvent({ id: "l1", text: "GUIDE", from: "u-lead", username: "lead_person" }));
    const { dmEvent } = await import("../support/helpers");
    await postWebhook(dmEvent({ text: "yes", from: "u-lead" }));
    await postWebhook(dmEvent({ text: "lead@example.com", from: "u-lead" }));
    const leads = (await api(cookie, "GET", "/api/leads")).data.leads;
    expect(leads).toHaveLength(1);
    expect(leads[0]).toMatchObject({
      email: "lead@example.com",
      username: "lead_person",
      rule_name: "Guide",
      step: "done",
      platform: "instagram",
    });
    expect((await api(cookie, "GET", "/api/conversations?step=done")).data.conversations).toHaveLength(1);
    expect((await api(cookie, "GET", "/api/conversations?step=opened")).data.conversations).toHaveLength(0);
    await testEnv.DB.prepare("INSERT INTO outbox (ts, due, job, attempts, status) VALUES (1, 2, ?, 0, 'pending')")
      .bind(JSON.stringify({ kind: "dm", platform: "instagram", text: "hi", userId: "u", ctx: {} }))
      .run();
    expect((await api(cookie, "GET", "/api/queue")).data.pending[0].job.text).toBe("hi");
  });
});
