// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeToken } from "../src/crypto";
import { refreshTokenIfNeeded } from "../src/maintenance";
import { getAccount, getSetting } from "../src/store";
import { api, connect, IG_ID, login, mockGraph, request, resetDb, testEnv } from "./helpers";

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
});

describe("public routes", () => {
  it("/health answers without login", async () => {
    const res = await request("/health");
    expect(await res.json()).toMatchObject({ ok: true, name: "opendm" });
  });
  it("serves the admin page and the privacy policy", async () => {
    const page = await request("/admin");
    expect(page.status).toBe(200);
    expect(await page.text()).toContain("OpenDM admin");
    expect(await (await request("/privacy")).text()).toContain("Privacy policy");
  });
  it("404s unknown paths", async () => {
    expect((await request("/nope")).status).toBe(404);
  });
});

describe("admin auth", () => {
  it("rejects every API call without a session", async () => {
    for (const [m, p] of [["GET", "/api/status"], ["GET", "/api/rules"], ["POST", "/api/rules"], ["POST", "/api/test"], ["GET", "/api/log"], ["POST", "/api/connect"], ["POST", "/api/enabled"]]) {
      const res = await request(p, { method: m, headers: { "Content-Type": "application/json" }, body: m === "POST" ? "{}" : undefined });
      expect(res.status, `${m} ${p}`).toBe(401);
    }
  });
  it("rejects a wrong password and sets no cookie", async () => {
    const { res, cookie } = await login("wrong");
    expect(res.status).toBe(401);
    expect(cookie).toBe("");
  });
  it("logs in with the right password: HttpOnly, SameSite=Strict cookie that unlocks the API", async () => {
    const { res, cookie } = await login();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("Set-Cookie")!;
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Strict/);
    expect((await api(cookie, "GET", "/api/status")).res.status).toBe(200);
  });
  it("rejects a forged or expired cookie", async () => {
    expect((await api("opendm_session=forged.abc", "GET", "/api/status")).res.status).toBe(401);
    const expired = await makeToken(testEnv.SESSION_SECRET, "admin", -10);
    expect((await api(`opendm_session=${expired}`, "GET", "/api/status")).res.status).toBe(401);
    const wrongKey = await makeToken("someone-elses-secret", "admin", 600);
    expect((await api(`opendm_session=${wrongKey}`, "GET", "/api/status")).res.status).toBe(401);
  });
  it("needs a JSON content type on writes (CSRF guard)", async () => {
    const { cookie } = await login();
    const res = await request("/api/enabled", { method: "POST", headers: { Cookie: cookie, "Content-Type": "text/plain" }, body: '{"enabled":false}' });
    expect(res.status).toBe(415);
  });
  it("locks out after 10 wrong passwords", async () => {
    for (let i = 0; i < 10; i++) await login("wrong");
    expect((await login("wrong")).res.status).toBe(429);
    expect((await login()).res.status).toBe(429);
  });
  it("logout clears the cookie", async () => {
    const { cookie } = await login();
    const res = await request("/api/logout", { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: "{}" });
    expect(res.headers.get("Set-Cookie")).toMatch(/Max-Age=0/);
  });
});

describe("rules", () => {
  it("creates, lists, updates and deletes a rule", async () => {
    const { cookie } = await login();
    const created = await api(cookie, "POST", "/api/rules", { name: "Guide", keywords: "guide, LINK", link: "https://example.com", public_replies: "a\nb", flow: { askEmail: "optional", followTimeoutMin: 30 } });
    expect(created.res.status).toBe(201);
    const id = created.data.rule.id;
    expect(created.data.rule).toMatchObject({ name: "Guide", keywords: ["guide", "LINK"], public_replies: ["a", "b"], enabled: true, fuzzy: true });
    expect(created.data.rule.flow).toMatchObject({ askEmail: "optional", followTimeoutMin: 30, requireFollow: true });

    expect((await api(cookie, "GET", "/api/rules")).data.rules).toHaveLength(1);
    const upd = await api(cookie, "PUT", `/api/rules/${id}`, { name: "Guide v2", keywords: ["guide"], link: "https://example.com/2", enabled: false });
    expect(upd.data.rule).toMatchObject({ name: "Guide v2", enabled: false, link: "https://example.com/2" });
    expect((await api(cookie, "DELETE", `/api/rules/${id}`)).res.status).toBe(200);
    expect((await api(cookie, "GET", "/api/rules")).data.rules).toEqual([]);
    expect((await api(cookie, "PUT", `/api/rules/${id}`, { keywords: "x" })).res.status).toBe(404);
  });
  it("validates input", async () => {
    const { cookie } = await login();
    expect((await api(cookie, "POST", "/api/rules", { keywords: " , " })).data.error).toMatch(/keyword/i);
    expect((await api(cookie, "POST", "/api/rules", { keywords: "a", link: "javascript:alert(1)" })).data.error).toMatch(/http/);
  });
});

describe("connect an account", () => {
  it("validates the token against /me and stores it sealed", async () => {
    const { cookie } = await login();
    const g = mockGraph();
    const token = "IGAAreal-looking-token-0123456789abcdef";
    const { res, data } = await api(cookie, "POST", "/api/connect", { token });
    expect(res.status).toBe(200);
    expect(data).toMatchObject({ connected: true, username: "shop_account", igId: IG_ID });
    expect(g.calls[0].auth).toBe(`Bearer ${token}`);
    const raw = await getSetting(testEnv, "ig_token");
    expect(raw).not.toContain("IGAAreal");
    expect(await getAccount(testEnv)).toMatchObject({ token, igId: IG_ID, username: "shop_account" });
    expect(JSON.stringify((await api(cookie, "GET", "/api/status")).data)).not.toContain("IGAAreal");
  });
  it("shows Instagram's complaint for a bad token and stores nothing", async () => {
    const { cookie } = await login();
    const g = mockGraph();
    g.on(/\/me/, () => Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 401 }));
    const { res, data } = await api(cookie, "POST", "/api/connect", { token: "IGAAbad-token-0123456789abcdef" });
    expect(res.status).toBe(400);
    expect(data.error).toContain("Invalid OAuth access token");
    expect(await getAccount(testEnv)).toBeNull();
    expect((await api(cookie, "POST", "/api/connect", { token: "short" })).res.status).toBe(400);
  });
  it("disconnects, and subscribes to webhook fields", async () => {
    const { cookie } = await login();
    await connect();
    const g = mockGraph();
    expect((await api(cookie, "POST", "/api/subscribe", {})).data).toEqual({ subscribed: true });
    expect(g.calls[0].url.search).toContain("subscribed_fields=comments,messages");
    await api(cookie, "POST", "/api/disconnect", {});
    expect(await getAccount(testEnv)).toBeNull();
    expect((await api(cookie, "POST", "/api/subscribe", {})).res.status).toBe(400);
  });
});

describe("status, switch and settings", () => {
  it("reports state and toggles the switch", async () => {
    const { cookie } = await login();
    await connect();
    const s = (await api(cookie, "GET", "/api/status")).data;
    expect(s).toMatchObject({ enabled: true, connected: true, username: "shop_account", webhookUrl: "https://opendm.test/webhook", oauthAvailable: true, hourlyLimit: 150 });
    expect((await api(cookie, "POST", "/api/enabled", { enabled: false })).data.enabled).toBe(false);
    expect((await api(cookie, "GET", "/api/status")).data.enabled).toBe(false);
  });
  it("validates the hourly limit", async () => {
    const { cookie } = await login();
    expect((await api(cookie, "POST", "/api/settings", { hourlyLimit: 0 })).res.status).toBe(400);
    expect((await api(cookie, "POST", "/api/settings", { hourlyLimit: 99999 })).res.status).toBe(400);
    expect((await api(cookie, "POST", "/api/settings", { hourlyLimit: 40 })).data.hourlyLimit).toBe(40);
    expect((await api(cookie, "GET", "/api/status")).data.hourlyLimit).toBe(40);
  });
});

describe("dry run tester", () => {
  async function setup(flow: object = {}) {
    const { cookie } = await login();
    await connect();
    await api(cookie, "POST", "/api/rules", { name: "Guide", keywords: "guide", link: "https://example.com/g", public_replies: "On its way!", flow });
    return cookie;
  }
  it("reports no match", async () => {
    const cookie = await setup();
    const { data } = await api(cookie, "POST", "/api/test", { comment: "nice pic" });
    expect(data.matched).toBe(false);
  });
  it("shows the public reply, the opener and the whole conversation", async () => {
    const cookie = await setup({ askEmail: "optional" });
    const { data } = await api(cookie, "POST", "/api/test", { comment: "GUIDE!", name: "Sam", replies: "yes\ndone\nme@x.io", following: "yes" });
    expect(data).toMatchObject({ matched: true, finalStep: "done", rule: { name: "Guide" } });
    const lines = data.transcript.map((t: any) => `${t.from}: ${t.text}`);
    expect(lines[1]).toBe("public: On its way!");
    expect(lines[2]).toContain("bot: Hey Sam!");
    expect(lines.at(-1)).toContain("https://example.com/g");
  });
  it("simulates the follow gate and the timeout", async () => {
    const cookie = await setup({ followTimeoutMin: 10, askEmail: "off" });
    const { data } = await api(cookie, "POST", "/api/test", { comment: "guide", replies: "yes", waitMinutes: 15 });
    expect(data.finalStep).toBe("done");
    expect(data.transcript.at(-1).text).toContain("here's the link anyway");
    const early = await api(cookie, "POST", "/api/test", { comment: "guide", replies: "yes", waitMinutes: 5 });
    expect(early.data.finalStep).toBe("awaiting_follow");
  });
  it("sends nothing to Instagram and stores nothing", async () => {
    const cookie = await setup();
    const g = mockGraph();
    await api(cookie, "POST", "/api/test", { comment: "guide", replies: "yes\ndone" });
    expect(g.calls).toEqual([]);
    expect((await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM conversations").first<any>()).n).toBe(0);
  });
});

describe("log", () => {
  it("lists events newest first, filtered by kind", async () => {
    const { cookie } = await login();
    await connect();
    const g = mockGraph();
    void g;
    await api(cookie, "POST", "/api/connect", { token: "IGAAreal-looking-token-0123456789abcdef" });
    const all = (await api(cookie, "GET", "/api/log?limit=5")).data.events;
    expect(all[0]).toMatchObject({ kind: "system", error: "connected @shop_account" });
    expect((await api(cookie, "GET", "/api/log?kind=dm")).data.events).toEqual([]);
  });
});

describe("OAuth with Instagram Login", () => {
  it("redirects to Instagram with a signed state and the right scopes", async () => {
    const { cookie } = await login();
    const res = await request("/admin/oauth/start", { headers: { Cookie: cookie }, redirect: "manual" });
    expect(res.status).toBe(302);
    const u = new URL(res.headers.get("Location")!);
    expect(u.origin + u.pathname).toBe("https://www.instagram.com/oauth/authorize");
    expect(u.searchParams.get("client_id")).toBe("1234567890");
    expect(u.searchParams.get("redirect_uri")).toBe("https://opendm.test/admin/oauth/callback");
    expect(u.searchParams.get("scope")).toContain("instagram_business_manage_messages");
    expect(u.searchParams.get("state")).toBeTruthy();
  });
  it("needs a login", async () => {
    const res = await request("/admin/oauth/start", { redirect: "manual" });
    expect(res.headers.get("Location")).toBe("https://opendm.test/admin");
  });
  it("callback exchanges the code for a long-lived token and connects the account", async () => {
    const { cookie } = await login();
    const g = mockGraph();
    g.on(/oauth\/access_token/, () => ({ data: [{ access_token: "IGAAshort-token-0123456789abcdef", user_id: IG_ID, permissions: "instagram_business_basic" }] }));
    g.on(/\/access_token\?grant_type=ig_exchange_token/, () => ({ access_token: "IGAAlong-token-0123456789abcdefgh", token_type: "bearer", expires_in: 5184000 }));
    const state = new URL((await request("/admin/oauth/start", { headers: { Cookie: cookie }, redirect: "manual" })).headers.get("Location")!).searchParams.get("state")!;
    const res = await request(`/admin/oauth/callback?code=AQDcode%23_&state=${encodeURIComponent(state)}`, { headers: { Cookie: cookie }, redirect: "manual" });
    expect(decodeURIComponent(res.headers.get("Location")!)).toContain("Connected @shop_account");
    const exchange = g.calls.find((c) => c.url.pathname.endsWith("/oauth/access_token"))!;
    expect(exchange.url.origin).toBe("https://oauth.test");
    expect(String(exchange.body)).toContain("code=AQDcode");
    expect(String(exchange.body)).not.toContain("%23_");
    expect(await getAccount(testEnv)).toMatchObject({ token: "IGAAlong-token-0123456789abcdefgh", igId: IG_ID });
    expect(Number(await getSetting(testEnv, "token_expires"))).toBeGreaterThan(Date.now() + 59 * 86_400_000);
  });
  it("callback refuses a bad state", async () => {
    const { cookie } = await login();
    const g = mockGraph();
    const res = await request("/admin/oauth/callback?code=x&state=forged", { headers: { Cookie: cookie }, redirect: "manual" });
    expect(decodeURIComponent(res.headers.get("Location")!)).toContain("state invalid");
    expect(g.calls).toEqual([]);
  });
});

describe("token refresh (cron)", () => {
  it("does nothing for fresh tokens and refreshes old ones, keeping the account", async () => {
    await connect();
    const g = mockGraph();
    expect(await refreshTokenIfNeeded(testEnv)).toBe("refreshed in the last day");
    await testEnv.DB.prepare("UPDATE settings SET value = ? WHERE key = 'token_refreshed'").bind(String(Date.now() - 2 * 86_400_000)).run();
    await testEnv.DB.prepare("INSERT INTO settings (key, value, updated) VALUES ('token_expires', ?, 0)").bind(String(Date.now() + 30 * 86_400_000)).run();
    expect(await refreshTokenIfNeeded(testEnv)).toBe("fresh enough");
    await testEnv.DB.prepare("UPDATE settings SET value = ? WHERE key = 'token_expires'").bind(String(Date.now() + 10 * 86_400_000)).run();
    expect(await refreshTokenIfNeeded(testEnv)).toBe("refreshed");
    expect(g.calls[0].url.pathname).toBe("/refresh_access_token");
    expect((await getAccount(testEnv))?.token).toBe("IGAArefreshed0000000000000000000000");
  });
  it("flags a failed refresh", async () => {
    await connect();
    await testEnv.DB.prepare("UPDATE settings SET value = '0' WHERE key = 'token_refreshed'").run();
    const g = mockGraph();
    g.on(/refresh_access_token/, () => Response.json({ error: { message: "Session expired", code: 190 } }, { status: 400 }));
    expect(await refreshTokenIfNeeded(testEnv)).toContain("refresh failed");
    expect(await getSetting(testEnv, "token_error")).toContain("Session expired");
  });
});
