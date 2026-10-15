// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Browser test of the admin dashboard: real Chrome (Playwright) against `wrangler dev` + a mock Graph API.
// Logs in, connects an account, creates a rule, runs the dry-run tester, sends a webhook and reads the log. Saves screenshots to docs/.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHmac } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { chromium } from "playwright-core";
import { startMockGraph } from "./mock-graph.mjs";

const PORT = 8789,
  GRAPH_PORT = 8798,
  BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "browser-app-secret",
  IG_ID = "17841400000000001",
  PASSWORD = "browser-password";
rmSync("e2e/.tmp-browser", { recursive: true, force: true });
mkdirSync("docs", { recursive: true });

const graph = await startMockGraph(GRAPH_PORT);
const vars = {
  ADMIN_PASSWORD: PASSWORD,
  SESSION_SECRET: "browser-session-secret-0123456789abcdef",
  VERIFY_TOKEN: "v",
  INSTAGRAM_APP_SECRET: SECRET,
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
const stop = async () => {
  try {
    await browser?.close();
  } catch {}
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
  graph.close();
};
process.on("exit", () => {
  try {
    process.kill(-dev.pid, "SIGTERM");
  } catch {}
});

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

try {
  for (let i = 0; i < 900; i++) {
    if ((await fetch(`${BASE}/health`).catch(() => null))?.ok) break;
    await sleep(100);
    if (i === 899) throw new Error("wrangler dev did not start");
  }
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await (
    await browser.newContext({ viewport: { width: 1100, height: 900 }, deviceScaleFactor: 1 })
  ).newPage();
  const consoleErrors = [];
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(e.message));
  page.setDefaultTimeout(8000);
  console.log("browser test\n");

  await step("admin page asks for a password", async () => {
    await page.goto(`${BASE}/admin`);
    await page.locator("#login").waitFor();
    assert.equal(await page.locator("#app").isVisible(), false);
    await page.screenshot({ path: "docs/login.png" });
  });
  await step("wrong password shows an error and stays logged out", async () => {
    await page.fill("#password", "nope");
    await page.click("#login-btn");
    await page.locator("#login-err").waitFor();
    assert.match(await page.locator("#login-err").innerText(), /Wrong password/);
    assert.equal(await page.locator("#app").isVisible(), false);
  });
  await step("right password opens the dashboard", async () => {
    await page.fill("#password", PASSWORD);
    await page.click("#login-btn");
    await page.locator("#app").waitFor();
    assert.match(await page.locator("#conn-pill").innerText(), /Not connected/);
  });
  await step("session survives a reload", async () => {
    await page.reload();
    await page.locator("#app").waitFor();
  });
  await step("connect an Instagram account by pasting a token", async () => {
    await page.fill("#token", "IGAAbrowser-token-0123456789abcdefghij");
    await page.click("#connect");
    await page.waitForFunction(
      () =>
        /connected/.test(document.getElementById("conn-pill").textContent) &&
        !/Not/.test(document.getElementById("conn-pill").textContent),
    );
    assert.match(await page.locator("#conn-pill").innerText(), /@e2e_shop connected/);
    assert.match(await page.locator("#webhook-url").innerText(), /\/webhook$/);
  });
  await step("create a keyword rule", async () => {
    await page.click('[data-tab="rules"]');
    await page.click("#new-rule");
    await page.fill("#f-name", "Free guide");
    await page.fill("#f-keywords", "GUIDE, LINK");
    await page.fill("#f-link", "https://example.com/free-guide");
    await page.fill("#f-replies", "Sent you a DM!\nCheck your inbox!");
    await page.selectOption("#fl-askEmail", "optional");
    await page.screenshot({ path: "docs/rule-editor.png", fullPage: true });
    await page.click("#save-rule");
    await page.locator("#rules-list tr[data-rule]").waitFor();
    const row = await page.locator("#rules-list tr[data-rule]").innerText();
    assert.match(row, /Free guide/);
    assert.match(row, /GUIDE/);
    assert.match(row, /example\.com\/free-guide/);
  });
  await step("rule validation shows an error for a bad link", async () => {
    await page.click("#new-rule");
    await page.fill("#f-keywords", "x");
    await page.fill("#f-link", "ftp://nope");
    await page.click("#save-rule");
    await page.locator("#editor-err").waitFor();
    assert.match(await page.locator("#editor-err").innerText(), /http/);
    await page.click("#cancel-rule");
  });
  await step("edit the rule and see the change", async () => {
    await page.click("[data-edit]");
    await page.fill("#f-name", "Free guide v2");
    await page.click("#save-rule");
    await page.waitForFunction(() => /Free guide v2/.test(document.getElementById("rules-list").innerText));
  });
  await step("dry run: comment -> opener -> follow -> email -> link", async () => {
    await page.click('[data-tab="test"]');
    await page.fill("#t-comment", "GUIDE please!");
    await page.fill("#t-name", "Sam");
    await page.fill("#t-replies", "yes\ndone\nsam@example.com");
    await page.selectOption("#t-following", "yes");
    await page.click("#t-run");
    await page.locator("#t-chat .bubble").first().waitFor();
    const text = await page.locator("#t-chat").innerText();
    assert.match(text, /Hey Sam!/);
    assert.match(text, /follow @e2e_shop/);
    assert.match(text, /Got it, thanks!/);
    assert.match(text, /https:\/\/example\.com\/free-guide/);
    assert.match(await page.locator("#t-matched").innerText(), /Matched rule: Free guide v2.*done/s);
    await page.screenshot({ path: "docs/dry-run.png", fullPage: true });
  });
  await step("dry run: a comment with no keyword says nothing would be sent", async () => {
    await page.fill("#t-comment", "love this!");
    await page.click("#t-run");
    await page.waitForFunction(() => /No rule matched/.test(document.getElementById("t-out").innerText));
  });
  await step("dry run: follow timeout sends the link anyway", async () => {
    await page.fill("#t-comment", "link");
    await page.fill("#t-replies", "yes");
    await page.fill("#t-wait", "30");
    await page.click("#t-run");
    await page.waitForFunction(() => /here's the link anyway/.test(document.getElementById("t-out").innerText));
  });
  await step("a real webhook comment shows up in the log as sent", async () => {
    const n = graph.calls.length;
    const res = await webhook({
      object: "instagram",
      entry: [
        {
          id: IG_ID,
          time: 1,
          changes: [
            {
              field: "comments",
              value: {
                from: { id: "17841499999999991", username: "sam_real" },
                media: { id: "18000000000000001" },
                id: "browser-c1",
                text: "guide",
              },
            },
          ],
        },
      ],
    });
    assert.equal(res.status, 200);
    for (let i = 0; i < 50 && graph.calls.length < n + 2; i++) await sleep(100);
    await page.click('[data-tab="log"]');
    await page.waitForFunction(() => /sam_real/.test(document.getElementById("log-body").innerText));
    const log = await page.locator("#log-body").innerText();
    assert.match(log, /sent/);
    assert.match(log, /GUIDE/i);
    await page.screenshot({ path: "docs/log.png", fullPage: true });
  });
  await step("switching automation off makes the next comment skipped", async () => {
    await page.click('[data-tab="overview"]');
    await page.locator("#enabled").uncheck();
    await page.waitForFunction(() => /Automation off/.test(document.getElementById("enabled-label").textContent));
    const n = graph.calls.filter((c) => c.path.endsWith("/messages")).length;
    await webhook({
      object: "instagram",
      entry: [
        {
          id: IG_ID,
          time: 2,
          changes: [
            {
              field: "comments",
              value: {
                from: { id: "17841477777777777", username: "late_comer" },
                media: { id: "1" },
                id: "browser-c2",
                text: "guide",
              },
            },
          ],
        },
      ],
    });
    await sleep(600);
    assert.equal(graph.calls.filter((c) => c.path.endsWith("/messages")).length, n);
    await page.click('[data-tab="log"]');
    await page.click("#log-refresh");
    await page.waitForFunction(() => /switched off/.test(document.getElementById("log-body").innerText));
    await page.click('[data-tab="overview"]');
    await page.locator("#enabled").check();
    await page.waitForFunction(() => /Automation on/.test(document.getElementById("enabled-label").textContent));
    await page.screenshot({ path: "docs/dashboard.png", fullPage: true });
  });
  await step("dark mode screenshots", async () => {
    await page.emulateMedia({ colorScheme: "dark" });
    await page.click('[data-tab="log"]');
    await page.waitForFunction(() => /sam_real/.test(document.getElementById("log-body").innerText));
    await page.screenshot({ path: "docs/log-dark.png", fullPage: true });
    await page.click('[data-tab="overview"]');
    await page.waitForSelector("#stats");
    await page.screenshot({ path: "docs/dashboard-dark.png", fullPage: true });
    await page.emulateMedia({ colorScheme: "light" });
  });
  await step("the stored token never reaches the page", async () => {
    const html = await page.content();
    assert.ok(!html.includes("IGAAbrowser-token"));
  });
  await step("delete the rule", async () => {
    await page.click('[data-tab="rules"]');
    page.once("dialog", (d) => d.accept());
    await page.click("[data-del]");
    await page.waitForFunction(() => /No rules yet/.test(document.getElementById("rules-list").innerText));
  });
  await step("log out returns to the login form", async () => {
    await page.click("#logout");
    await page.locator("#login").waitFor();
    await page.goto(`${BASE}/admin`);
    await page.locator("#login").waitFor();
  });
  await step("no JavaScript errors in the console", async () => {
    const real = consoleErrors.filter((e) => !/status of (401|400) /.test(e));
    assert.deepEqual(real, []);
  });
} catch (e) {
  failed++;
  console.log("FATAL", e.message, "\n", devLog.slice(-1200));
} finally {
  await stop();
}
console.log(`\nbrowser: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
