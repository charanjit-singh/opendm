// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// End to end: real `wrangler dev` (workerd + local D1) talking to a local mock of the Instagram Graph API.
// Posts signed webhook payloads and asserts the Graph calls the Worker makes.
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { spawn } from "node:child_process";
import { rmSync } from "node:fs";
import { startMockGraph } from "./mock-graph.mjs";

const PORT = 8788, GRAPH_PORT = 8799, BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "e2e-app-secret", IG_ID = "17841400000000001", USER = "17841499999999991";
const STATE = "e2e/.tmp/state";
rmSync("e2e/.tmp", { recursive: true, force: true });

const graph = await startMockGraph(GRAPH_PORT);
const vars = { ADMIN_PASSWORD: "e2e-password", SESSION_SECRET: "e2e-session-secret-0123456789abcdef", VERIFY_TOKEN: "e2e-verify", INSTAGRAM_APP_SECRET: SECRET, GRAPH_BASE: `http://127.0.0.1:${GRAPH_PORT}`, OAUTH_BASE: `http://127.0.0.1:${GRAPH_PORT}` };
const args = ["wrangler", "dev", "--ip", "127.0.0.1", "--port", String(PORT), "--persist-to", STATE, ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`])];
const dev = spawn("npx", args, { stdio: ["ignore", "pipe", "pipe"], detached: true });
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
const stop = () => { try { process.kill(-dev.pid, "SIGTERM"); } catch {} graph.close(); };
process.on("exit", stop);

let passed = 0, failed = 0;
async function step(name, fn) {
  try { await fn(); passed++; console.log(`  ok   ${name}`); } catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split("\n").join("\n       ")}`); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, what, ms = 8000) {
  const t = Date.now();
  while (Date.now() - t < ms) { const v = await fn(); if (v) return v; await sleep(100); }
  throw new Error(`timed out waiting for ${what}`);
}
const sign = (body) => "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
const post = (payload, sig) => { const body = JSON.stringify(payload); return fetch(`${BASE}/webhook`, { method: "POST", headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sig ?? sign(body) }, body }); };
const comment = (id, text, from = USER) => ({ object: "instagram", entry: [{ id: IG_ID, time: 1760000000, changes: [{ field: "comments", value: { from: { id: from, username: "sam" }, media: { id: "18000000000000001", media_product_type: "FEED" }, id, text } }] }] });
const dm = (text, mid) => ({ object: "instagram", entry: [{ id: IG_ID, time: 1760000100, messaging: [{ sender: { id: USER }, recipient: { id: IG_ID }, timestamp: 1760000100000, message: { mid, text } }] }] });
const messages = () => graph.calls.filter((c) => c.method === "POST" && c.path.endsWith("/messages"));
const replies = () => graph.calls.filter((c) => c.method === "POST" && c.path.endsWith("/replies"));

try {
  await until(async () => (await fetch(`${BASE}/health`).catch(() => null))?.ok, "wrangler dev to start", 90000);
  console.log("wrangler dev is up, running e2e\n");
  let cookie = "";
  const api = async (method, path, body) => { const r = await fetch(BASE + path, { method, headers: { "Content-Type": "application/json", Cookie: cookie }, body: body === undefined ? undefined : JSON.stringify(body) }); return { status: r.status, data: await r.json().catch(() => ({})), headers: r.headers }; };

  await step("health endpoint", async () => assert.equal((await api("GET", "/health")).data.ok, true));
  await step("admin API refuses without login", async () => assert.equal((await api("GET", "/api/status")).status, 401));
  await step("login sets a session cookie", async () => { const r = await api("POST", "/api/login", { password: vars.ADMIN_PASSWORD }); assert.equal(r.status, 200); cookie = r.headers.get("set-cookie").split(";")[0]; });
  await step("webhook handshake: right token echoes the challenge, wrong token is 403", async () => {
    const ok = await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=${vars.VERIFY_TOKEN}&hub.challenge=424242`);
    assert.equal(await ok.text(), "424242");
    assert.equal((await fetch(`${BASE}/webhook?hub.mode=subscribe&hub.verify_token=bad&hub.challenge=1`)).status, 403);
  });
  await step("connect an account (token validated against the mock Graph /me)", async () => {
    const r = await api("POST", "/api/connect", { token: "IGAAe2e-token-0123456789abcdefghij" });
    assert.equal(r.data.username, "e2e_shop");
    const me = graph.calls.find((c) => c.path.endsWith("/me"));
    assert.equal(me.auth, "Bearer IGAAe2e-token-0123456789abcdefghij");
  });
  await step("create a rule with follow gate + optional email", async () => {
    const r = await api("POST", "/api/rules", { name: "Guide", keywords: "GUIDE", link: "https://example.com/guide", public_replies: "Check your DMs!", flow: { requireFollow: true, askEmail: "optional" } });
    assert.equal(r.status, 201);
  });
  await step("unsigned / wrongly signed webhooks are rejected and cause no Graph calls", async () => {
    const before = graph.calls.length;
    assert.equal((await post(comment("c-bad", "GUIDE"), "sha256=" + "00".repeat(32))).status, 401);
    assert.equal((await fetch(`${BASE}/webhook`, { method: "POST", body: "{}" })).status, 401);
    await sleep(300);
    assert.equal(graph.calls.length, before);
  });
  await step("comment 'GUIDE' -> private reply to the comment + public reply", async () => {
    assert.equal((await post(comment("c-1", "GUIDE please!"))).status, 200);
    await until(() => replies().length >= 1, "the public reply");
    const priv = messages()[0];
    assert.equal(priv.path, `/v25.0/${IG_ID}/messages`);
    assert.deepEqual(priv.body.recipient, { comment_id: "c-1" });
    assert.match(priv.body.message.text, /Want the link\?/);
    assert.equal(priv.auth, "Bearer IGAAe2e-token-0123456789abcdefghij");
    assert.equal(replies()[0].path, "/v25.0/c-1/replies");
    assert.equal(replies()[0].body.message, "Check your DMs!");
  });
  await step("retried webhook for the same comment is deduped", async () => {
    const n = graph.calls.length;
    await post(comment("c-1", "GUIDE please!"));
    await sleep(400);
    assert.equal(graph.calls.length, n);
  });
  await step("user replies 'yes' -> follow request DM", async () => {
    await post(dm("yes", "m-1"));
    await until(() => messages().length >= 2, "the follow DM");
    const m = messages()[1];
    assert.deepEqual(m.body.recipient, { id: USER });
    assert.match(m.body.message.text, /follow @e2e_shop/);
  });
  await step("user says 'done' -> follow verified through the profile API -> email ask", async () => {
    await post(dm("done", "m-2"));
    await until(() => messages().length >= 3, "the email DM");
    assert.ok(graph.calls.some((c) => c.method === "GET" && c.query.fields?.includes("is_user_follow_business")));
    assert.match(messages()[2].body.message.text, /your email/);
  });
  await step("user sends an email -> thanks + the link", async () => {
    await post(dm("sam@example.com", "m-3"));
    await until(() => messages().length >= 5, "the link DM");
    assert.equal(messages()[3].body.message.text, "Got it, thanks!");
    assert.match(messages()[4].body.message.text, /https:\/\/example\.com\/guide/);
  });
  await step("a user who does not follow does not get the link", async () => {
    graph.state.following = false;
    await post(comment("c-2", "guide", "17841488888888888"));
    await until(() => messages().length >= 6, "opener");
    const dm2 = (text, mid) => ({ ...dm(text, mid), entry: [{ ...dm(text, mid).entry[0], messaging: [{ ...dm(text, mid).entry[0].messaging[0], sender: { id: "17841488888888888" } }] }] });
    await post(dm2("yes", "m-4"));
    await until(() => messages().length >= 7, "follow ask");
    await post(dm2("done", "m-5"));
    await until(() => messages().length >= 8, "retry");
    assert.match(messages()[7].body.message.text, /can't see the follow/);
    assert.ok(!messages().slice(5).some((m) => /example\.com\/guide/.test(m.body.message.text)));
  });
  await step("the scheduled job runs cleanly", async () => {
    const r = await fetch(`${BASE}/cdn-cgi/local/scheduled?cron=*+*+*+*+*`);
    assert.equal(r.status, 200);
  });
  await step("event log has the whole story", async () => {
    const { data } = await api("GET", "/api/log?limit=100");
    assert.ok(data.events.some((e) => e.kind === "comment" && e.status === "sent" && e.keyword === "GUIDE"));
    assert.ok(data.events.some((e) => e.kind === "dm" && e.status === "sent"));
    assert.ok(!JSON.stringify(data).includes("IGAAe2e-token"), "token must never be logged");
  });
} catch (e) {
  failed++;
  console.log("FATAL", e.message);
  console.log(devLog.slice(-1500));
} finally {
  stop();
}
console.log(`\ne2e: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
