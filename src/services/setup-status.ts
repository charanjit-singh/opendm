// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The onboarding checklist: what is done, what is next, and what only a person can do.
import { getAccount } from "../db/accounts";
import { getAppCredentials } from "../db/app-credentials";
import { getSetting, SETTING } from "../db/settings";
import type { Platform, SetupCheck, SetupReport, SetupStep } from "../types/api";
import type { Env } from "../types/env";
import { clientFor } from "./account-client";

const PLATFORMS: Platform[] = ["instagram", "facebook"];

const ago = (ts: number) => `${Math.max(0, Math.round((Date.now() - ts) / 60_000))} min ago`;

export async function buildSetupReport(env: Env, origin: string): Promise<SetupReport> {
  const creds = {
    instagram: await getAppCredentials(env, "instagram"),
    facebook: await getAppCredentials(env, "facebook"),
  };
  const accounts = { instagram: await getAccount(env, "instagram"), facebook: await getAccount(env, "facebook") };
  const connected = PLATFORMS.filter((p) => accounts[p]);
  const lastWebhook = Number((await getSetting(env, SETTING.lastWebhookAt)) ?? 0);
  const subscribed = [];
  for (const p of PLATFORMS) if (await getSetting(env, `subscribed_${p}`)) subscribed.push(p);
  const count = async (sql: string) => (await env.DB.prepare(sql).first<{ n: number }>())?.n ?? 0;
  const rules = await count("SELECT COUNT(*) AS n FROM rules WHERE enabled = 1");
  const comments = await count("SELECT COUNT(*) AS n FROM events WHERE kind = 'comment' AND status != 'error'");
  const tokenProblems = [await getSetting(env, SETTING.tokenError), await getSetting(env, SETTING.fbTokenError)].filter(
    (e): e is string => !!e,
  );

  const haveApp = PLATFORMS.filter((p) => creds[p].id && creds[p].secret);
  const steps: SetupStep[] = [
    {
      id: "server",
      title: "OpenDM is running",
      status: env.VERIFY_TOKEN && env.ADMIN_PASSWORD ? "ok" : "warn",
      detail: `Webhook URL: ${origin}/webhook`,
      help: "Set the ADMIN_PASSWORD, SESSION_SECRET and VERIFY_TOKEN secrets (wrangler secret put).",
    },
    {
      id: "app",
      title: "Meta app credentials",
      status: haveApp.length ? "ok" : "todo",
      detail: haveApp.length ? `App ID and secret saved for: ${haveApp.join(", ")}` : "No app ID and secret yet.",
      help: "Create a Meta app (developers.facebook.com/apps), add the Instagram product and, for Facebook, Messenger. Then enter its App ID and App secret.",
      needsHuman: !haveApp.length,
    },
    {
      id: "connect",
      title: "Connect Instagram and/or a Facebook Page",
      status: connected.length ? "ok" : "todo",
      detail: connected.length
        ? connected
            .map(
              (p) =>
                `${p}: ${accounts[p]?.username ?? accounts[p]?.accountId} (${accounts[p]?.mode.replace("_", " ")})`,
            )
            .join("; ")
        : "Nothing connected.",
      help: "Use Connect with Instagram / Facebook (OAuth), or paste an access token.",
      needsHuman: !connected.length,
    },
    {
      id: "token",
      title: "Token is healthy",
      status: !connected.length ? "todo" : tokenProblems.length ? "warn" : "ok",
      detail:
        tokenProblems[0] ??
        (connected.length ? "No token errors. Instagram tokens refresh automatically." : "Connect an account first."),
      help: "Reconnect the account to get a fresh token.",
      needsHuman: tokenProblems.length > 0,
    },
    {
      id: "webhook",
      title: "Webhook subscribed",
      status: !connected.length ? "todo" : subscribed.length || lastWebhook ? "ok" : "todo",
      detail: subscribed.length
        ? `Subscribed: ${subscribed.join(", ")}`
        : lastWebhook
          ? "Events are arriving."
          : "Not subscribed yet.",
      help: "In the Meta app set the callback URL and verify token, subscribe to comments and messages (feed for Facebook), then click Subscribe.",
    },
    {
      id: "events",
      title: "A webhook event arrived",
      status: lastWebhook ? "ok" : "todo",
      detail: lastWebhook ? `Last event ${ago(lastWebhook)}.` : "No signed webhook received yet.",
      help: "Send a test from the Meta webhooks page, or comment on one of your posts from a second account that has a role on the app.",
      needsHuman: !lastWebhook,
    },
    {
      id: "rule",
      title: "At least one rule",
      status: rules ? "ok" : "todo",
      detail: rules ? `${rules} enabled rule${rules === 1 ? "" : "s"}.` : "No rules yet.",
      help: "Create a rule: keyword, link, and whether to ask for a follow or an email.",
    },
    {
      id: "comment",
      title: "A real comment went through",
      status: comments ? "ok" : "todo",
      detail: comments ? `${comments} comment${comments === 1 ? "" : "s"} seen.` : "No comments processed yet.",
      help: "Comment the keyword on your own post from a second account (a tester on the app) and check the Log tab.",
      needsHuman: !comments,
    },
    {
      id: "review",
      title: "Development mode and App Review",
      status: "info",
      detail:
        "In development mode only people with a role on the app (admins, developers, testers) trigger the automation.",
      help: "For the public, switch the app to Live and request Advanced Access through App Review (docs/onboarding.md).",
    },
  ];
  const next = steps.find((s) => s.status === "todo" || s.status === "warn") ?? null;
  return { steps, next, ready: !next };
}

/** Live checks against Meta: is each token accepted, and which webhook fields is the app subscribed to? */
export async function runSetupChecks(env: Env): Promise<SetupCheck[]> {
  const checks: SetupCheck[] = [];
  for (const platform of PLATFORMS) {
    const account = await getAccount(env, platform);
    if (!account) {
      checks.push({ name: `${platform} account`, ok: false, detail: "not connected" });
      continue;
    }
    const client = clientFor(env, account);
    const who = await client.graph.get<{ username?: string; name?: string; id?: string }>(
      platform === "instagram" && account.mode === "instagram_login"
        ? "/me?fields=user_id,username"
        : `/${account.accountId}?fields=${platform === "instagram" ? "username" : "name"}`,
    );
    checks.push({
      name: `${platform} token`,
      ok: who.ok,
      detail: who.ok ? `accepted for ${who.data.username ?? who.data.name ?? account.accountId}` : who.error,
    });
    const fields = await client.subscribedFields();
    checks.push({
      name: `${platform} webhook subscription`,
      ok: fields.ok && fields.data.length > 0,
      detail: fields.ok
        ? fields.data.length
          ? `subscribed to ${fields.data.join(", ")}`
          : "not subscribed to any field"
        : fields.error,
    });
  }
  const last = Number((await getSetting(env, SETTING.lastWebhookAt)) ?? 0);
  checks.push({
    name: "webhook events",
    ok: !!last,
    detail: last ? `last signed event ${ago(last)}` : "none received yet",
  });
  return checks;
}
