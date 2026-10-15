// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Browser test of the dashboard: real Chrome (Playwright) against `wrangler dev` + a mock Graph API.
// Walks the first-run setup wizard (app credentials, Instagram, Facebook Page, webhook), creates a rule with message
// variants, dry-runs it, sends real webhooks and reads the log. Saves light-theme screenshots (2x) to docs/.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { IG_ID, PAGE_ID, startMockGraph } from "./mock-graph.mjs";

const PORT = 8789,
  GRAPH_PORT = 8798,
  BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "instagram-app-secret-abcdef",
  PASSWORD = "browser-password";
rmSync("e2e/.tmp-browser", { recursive: true, force: true });
mkdirSync("docs", { recursive: true });

const graph = await startMockGraph(GRAPH_PORT);
// No app credentials on purpose: the wizard has to collect them.
const vars = {
  ADMIN_PASSWORD: PASSWORD,
  SESSION_SECRET: "browser-session-secret-0123456789abcdef",
  VERIFY_TOKEN: "acme-verify-token",
  GRAPH_BASE: `http://127.0.0.1:${GRAPH_PORT}`,
  OAUTH_BASE: `http://127.0.0.1:${GRAPH_PORT}`,
};
const dev = spawn(
  "npx",
  [
    "wrangler",
    "dev",
    "--ip",
    "127.0.0.1",
    "--port",
    String(PORT),
    "--persist-to",
    "e2e/.tmp-browser",
    ...Object.entries(vars).flatMap(([k, v]) => ["--var", `${k}:${v}`]),
  ],
  { stdio: ["ignore", "pipe", "pipe"], detached: true },
);
let devLog = "";
dev.stdout.on("data", (d) => (devLog += d));
dev.stderr.on("data", (d) => (devLog += d));
let browser;
const killDev = () => {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
};
const stop = async () => {
  try {
    await browser?.close();
  } catch {}
  killDev();
  graph.close();
};
process.on("exit", killDev);

let passed = 0,
  failed = 0;
async function step(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`  ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL ${name}\n       ${e.message.split("\n").join("\n       ")}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const sign = (body) => `sha256=${createHmac("sha256", SECRET).update(body).digest("hex")}`;
const webhook = (payload) => {
  const body = JSON.stringify(payload);
  return fetch(`${BASE}/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Hub-Signature-256": sign(body) },
    body,
  });
};
const igComment = (id, text, from, username) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ID,
      time: 1,
      changes: [
        { field: "comments", value: { from: { id: from, username }, media: { id: "18000000000000001" }, id, text } },
      ],
    },
  ],
});
const fbComment = (id, text, from, name) => ({
  object: "page",
  entry: [
    {
      id: PAGE_ID,
      time: 1,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: "add",
            comment_id: id,
            post_id: `${PAGE_ID}_555`,
            parent_id: `${PAGE_ID}_555`,
            message: text,
            from: { id: from, name },
          },
        },
      ],
    },
  ],
});
const text = (page, selector) => page.locator(selector).innerText();
const stepStatus = (page, id) => page.locator(`#setup-step-${id}`).getAttribute("data-status");

try {
  for (let i = 0; i < 900; i++) {
    if ((await fetch(`${BASE}/health`).catch(() => null))?.ok) break;
    await sleep(100);
    if (i === 899) throw new Error("wrangler dev did not start");
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (
    await browser.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: "light" })
  ).newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.setDefaultTimeout(8000);
  console.log("browser test\n");

  await step("the admin page asks for a password", async () => {
    await page.goto(`${BASE}/admin`);
    await page.locator("#login").waitFor();
    assert.equal(await page.locator("#app").count(), 0);
    await page.screenshot({ path: "docs/login.png" });
  });
  await step("a wrong password shows an error and stays logged out", async () => {
    await page.fill("#password", "nope");
    await page.click("#login-btn");
    assert.match(await text(page, "#login-err"), /Wrong password/);
    assert.equal(await page.locator("#app").count(), 0);
  });
  await step("the right password opens the dashboard on the Setup wizard (first run)", async () => {
    await page.fill("#password", PASSWORD);
    await page.click("#login-btn");
    await page.locator("#setup").waitFor();
    assert.match(await text(page, "#conn-pill"), /Not connected/);
    assert.equal(await stepStatus(page, "server"), "ok");
    assert.equal(await stepStatus(page, "app"), "todo");
    assert.equal(await stepStatus(page, "connect"), "todo");
  });
  await step("step 2: Meta app credentials are saved (secret stored encrypted) and the step turns green", async () => {
    await page.click("#setup-step-app summary");
    assert.match(await text(page, "#setup-step-app .guide"), /Create app/);
    await page.fill("#app-id", "1234567890123456");
    await page.fill("#app-secret", "instagram-app-secret-abcdef");
    await page.click("#save-credentials");
    await page.waitForFunction(() => document.querySelector("#setup-step-app")?.getAttribute("data-status") === "ok");
    await page.selectOption("#app-platform", "facebook");
    await page.fill("#app-id", "6655443322110099");
    await page.fill("#app-secret", "facebook-app-secret-abcdef");
    await page.click("#save-credentials");
    await page.waitForFunction(() =>
      /facebook/.test(document.querySelector("#setup-step-app .step__detail")?.textContent ?? ""),
    );
  });
  await step("step 3: connect Instagram by pasting a token", async () => {
    assert.ok(await page.locator("#oauth-instagram").isVisible(), "the OAuth button appears once the app ID is saved");
    assert.match(
      await page.locator("#oauth-instagram").getAttribute("href"),
      /\/admin\/oauth\/start\?platform=instagram/,
    );
    await page.click("#connect-instagram summary");
    await page.fill("#token-instagram", "IGAAbrowser-token-0123456789abcdefghij");
    await page.click("#connect-instagram-btn");
    await page.waitForFunction(() => /@acme_studio/.test(document.getElementById("conn-pill")?.textContent ?? ""));
  });
  await step("step 3: connect a Facebook Page from a user token and choose the Page", async () => {
    await page.click("#connect-facebook summary");
    await page.fill("#token-facebook", "EAAuser00000000000000000000000000");
    await page.click("#connect-facebook-btn");
    await page.locator("#page-chooser").waitFor();
    assert.match(await text(page, "#page-chooser"), /Acme Studio/);
    assert.match(await text(page, "#page-chooser"), /Acme Labs/);
    await page.click(`[data-page="${PAGE_ID}"]`);
    await page.waitForFunction(() => /Page Acme Studio/.test(document.getElementById("conn-pill")?.textContent ?? ""));
    assert.equal(await stepStatus(page, "connect"), "ok");
  });
  await step(
    "step 5: the webhook details are shown, the verify token is revealed on demand, and Subscribe works",
    async () => {
      assert.match(await text(page, "#setup-callback"), /\/webhook$/);
      assert.doesNotMatch(await text(page, "#setup-verify-token"), /acme-verify-token/);
      await page.click("#reveal-token");
      assert.equal(await text(page, "#setup-verify-token"), "acme-verify-token");
      await page.click("#setup-subscribe-instagram");
      await page.click("#setup-subscribe-facebook");
      await page.waitForFunction(
        () => document.querySelector("#setup-step-webhook")?.getAttribute("data-status") === "ok",
      );
      const subs = graph.calls.filter((c) => c.method === "POST" && c.path.endsWith("/subscribed_apps"));
      assert.equal(subs.length, 2);
      await page.waitForFunction(() =>
        /facebook/.test(document.querySelector("#setup-step-webhook .step__detail")?.textContent ?? ""),
      );
      await page.screenshot({ path: "docs/setup.png", fullPage: true });
    },
  );
  await step("live checks call Meta and show a result per token and subscription", async () => {
    await page.click("#setup-live-checks");
    await page.locator("#setup-checks li").first().waitFor();
    const list = await text(page, "#setup-checks");
    assert.match(list, /✓ instagram token/);
    assert.match(list, /✓ facebook token/);
    assert.match(list, /instagram webhook subscription: subscribed to comments, messages/);
    assert.match(list, /✗ webhook events: none received yet/);
  });
  await step("create a rule for both channels with message variants and keyword-DM trigger", async () => {
    await page.click('[data-tab="rules"]');
    await page.click("#new-rule");
    await page.fill("#f-name", "AUTOMATION guide");
    await page.fill("#f-keywords", "AUTOMATION, GUIDE");
    await page.fill("#f-link", "https://acmestudio.example/automation-guide");
    await page.selectOption("#f-channel", "both");
    await page.check("#f-dm-trigger");
    await page.fill("#f-replies", "Sent you a DM!\nCheck your inbox!\nJust DM'd you :)");
    await page.selectOption("#fl-askEmail", "optional");
    await page.fill(
      "#fl-openerText",
      "Hey {name}! Saw your comment. Want the automation guide? Reply yes and I'll send it.",
    );
    await page.click("#fl-openerText-add");
    await page.fill("#fl-openerText-2", "Hi {name}, thanks for commenting! Want the free guide? Just reply yes.");
    await page.click("#fl-openerText-add");
    await page.fill("#fl-openerText-3", "{name}, glad you asked! Reply yes and the guide is yours.");
    assert.match(await text(page, "#editor"), /3 wordings, cycled/);
    await page.screenshot({ path: "docs/rule-editor.png", fullPage: true });
    await page.click("#save-rule");
    await page.locator("#rules-list tr[data-rule]").waitFor();
    const row = await text(page, "#rules-list tr[data-rule]");
    assert.match(row, /AUTOMATION guide/);
    assert.match(row, /both/);
  });
  await step("a rule with a bad link is refused with a clear message", async () => {
    await page.click("#new-rule");
    await page.fill("#f-keywords", "x");
    await page.fill("#f-link", "ftp://nope");
    await page.click("#save-rule");
    assert.match(await text(page, "#editor-err"), /http/);
    await page.click("#cancel-rule");
  });
  await step("dry run: the opener cycles through its wordings and you can preview a specific one", async () => {
    await page.click('[data-tab="test"]');
    await page.fill("#t-comment", "AUTOMATION please!");
    await page.fill("#t-name", "Sam");
    await page.fill("#t-replies", "yes\ndone\nsam@example.com");
    await page.selectOption("#t-following", "yes");
    await page.click("#t-run");
    await page.locator("#t-chat .bubble").first().waitFor();
    let chat = await text(page, "#t-chat");
    assert.match(chat, /Hey Sam! Saw your comment/);
    assert.match(chat, /openerText#1\/3/);
    assert.match(chat, /https:\/\/acmestudio\.example\/automation-guide/);
    assert.match(await text(page, "#t-matched"), /Matched rule: AUTOMATION guide.*done/s);
    await page.screenshot({ path: "docs/dry-run.png", fullPage: true });
    await page.fill("#t-variant", "3");
    await page.selectOption("#t-platform", "facebook");
    await page.click("#t-run");
    await page.waitForFunction(() => /glad you asked/.test(document.getElementById("t-chat")?.textContent ?? ""));
    chat = await text(page, "#t-chat");
    assert.match(chat, /like our Page/);
  });
  await step("dry run: a comment with no keyword, and the follow timeout", async () => {
    await page.fill("#t-variant", "");
    await page.fill("#t-comment", "love this!");
    await page.click("#t-run");
    await page.waitForFunction(() => /No rule matched/.test(document.getElementById("t-out")?.textContent ?? ""));
    await page.fill("#t-comment", "guide");
    await page.fill("#t-replies", "yes");
    await page.fill("#t-wait", "30");
    await page.click("#t-run");
    await page.waitForFunction(() =>
      /here's the link anyway/.test(document.getElementById("t-out")?.textContent ?? ""),
    );
  });
  await step(
    "real webhooks: an Instagram and a Facebook comment are handled, wordings alternate, and both show in the log",
    async () => {
      const privateReplies = () =>
        graph.calls.filter((c) => c.path.endsWith("/messages") && c.body?.recipient?.comment_id);
      // One at a time: the round-robin counter is read when each comment is handled.
      const comments = [
        igComment("ig-c-1", "AUTOMATION", "17841499999999991", "sam_rivera"),
        fbComment("fb-c-1", "automation", "5500110022", "Priya Shah"),
        igComment("ig-c-2", "guide", "17841488888888888", "maya.designs"),
      ];
      for (const [i, payload] of comments.entries()) {
        assert.equal((await webhook(payload)).status, 200);
        for (let n = 0; n < 80 && privateReplies().length < i + 1; n++) await sleep(100);
        await sleep(250);
      }
      const bodies = privateReplies().map((c) => c.body.message.text.replace(/^[^!,]*[!,]/, "X"));
      assert.equal(new Set(bodies).size, 3, `three comments, three different wordings: ${bodies}`);
      await page.click('[data-tab="log"]');
      await page.waitForFunction(() => /maya\.designs/.test(document.getElementById("log-body")?.textContent ?? ""));
      const log = await text(page, "#log-body");
      assert.match(log, /instagram/);
      assert.match(log, /facebook/);
      assert.match(log, /openerText#[123]\/3/);
      await page.screenshot({ path: "docs/log.png", fullPage: true });
    },
  );
  await step("setup now shows events and a real comment as done", async () => {
    await page.click('[data-tab="setup"]');
    await page.click("#setup-recheck");
    await page.waitForFunction(
      () => document.querySelector("#setup-step-events")?.getAttribute("data-status") === "ok",
    );
    assert.equal(await stepStatus(page, "rule"), "ok");
    assert.equal(await stepStatus(page, "comment"), "ok");
  });
  await step("overview shows both channels; automation can be switched off and on", async () => {
    await page.click('[data-tab="overview"]');
    assert.match(await text(page, "#account-instagram"), /@acme_studio/);
    assert.match(await text(page, "#account-facebook"), /Acme Studio/);
    await page.locator("#enabled").uncheck();
    await page.waitForFunction(() =>
      /Automation off/.test(document.getElementById("enabled-label")?.textContent ?? ""),
    );
    const n = graph.calls.filter((c) => c.path.endsWith("/messages")).length;
    await webhook(igComment("ig-c-3", "AUTOMATION", "17841477777777777", "late_comer"));
    await sleep(600);
    assert.equal(graph.calls.filter((c) => c.path.endsWith("/messages")).length, n);
    await page.locator("#enabled").check();
    await page.waitForFunction(() => /Automation on/.test(document.getElementById("enabled-label")?.textContent ?? ""));
    await page.screenshot({ path: "docs/dashboard.png", fullPage: true });
  });
  await step("tokens never reach the page", async () => {
    const html = await page.content();
    assert.ok(!html.includes("IGAAbrowser-token"));
    assert.ok(!html.includes("instagram-app-secret"));
    assert.ok(!html.includes("EAApagetoken"));
  });
  await step("delete the rule, then log out", async () => {
    await page.click('[data-tab="rules"]');
    page.once("dialog", (d) => d.accept());
    await page.click("[data-del]");
    await page.waitForFunction(() => /No rules yet/.test(document.getElementById("rules-list")?.textContent ?? ""));
    await page.click("#logout");
    await page.locator("#login").waitFor();
    await page.goto(`${BASE}/admin`);
    await page.locator("#login").waitFor();
  });
  await step("no JavaScript errors in the console", async () => {
    assert.deepEqual(
      consoleErrors.filter((e) => !/status of (401|400) /.test(e)),
      [],
    );
  });
} catch (e) {
  failed++;
  console.log("FATAL", e.message, "\n", devLog.slice(-1200));
} finally {
  await stop();
}
console.log(`\nbrowser: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
