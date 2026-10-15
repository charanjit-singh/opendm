// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { listConversations } from "../../db/conversations";
import { recentEvents } from "../../db/events";
import { isEnabled, SETTING, setSetting } from "../../db/settings";
import { parseBody } from "../../lib/validate";
import { requireAdmin } from "../../middleware/admin-auth";
import { dryRun } from "../../services/dry-run";
import { buildStatus } from "../../services/status";
import { refreshTokenIfNeeded } from "../../services/token-refresh";
import type { AppEnv } from "../../types/app";
import { dryRunSchema, enabledSchema, settingsSchema } from "../schemas";
import { accountRoutes } from "./account";
import { ruleRoutes } from "./rules";
import { setupRoutes } from "./setup";

/** The dashboard API. Everything here needs the admin session or an admin bearer token. */
export const adminRoutes = new Hono<AppEnv>();

adminRoutes.use("*", requireAdmin);

adminRoutes.get("/status", async (c) => c.json(await buildStatus(c.env, new URL(c.req.url).origin)));

adminRoutes.post("/enabled", async (c) => {
  const { enabled } = await parseBody(c, enabledSchema);
  await setSetting(c.env, SETTING.enabled, enabled ? "1" : "0");
  return c.json({ enabled: await isEnabled(c.env) });
});

adminRoutes.post("/settings", async (c) => {
  const { hourlyLimit } = await parseBody(c, settingsSchema);
  await setSetting(c.env, SETTING.hourlyLimit, String(hourlyLimit));
  return c.json({ hourlyLimit });
});

adminRoutes.post("/test", async (c) => c.json(await dryRun(c.env, await parseBody(c, dryRunSchema))));

adminRoutes.get("/log", async (c) => {
  const limit = Math.min(200, Math.max(1, Number(c.req.query("limit")) || 50));
  return c.json({ events: await recentEvents(c.env, limit, c.req.query("kind") || undefined) });
});

adminRoutes.get("/conversations", async (c) => {
  const step = c.req.query("step") || undefined;
  const limit = Number(c.req.query("limit")) || 100;
  return c.json({ conversations: await listConversations(c.env, { step, limit }) });
});

/** People who gave an email in the flow. */
adminRoutes.get("/leads", async (c) =>
  c.json({ leads: await listConversations(c.env, { onlyWithEmail: true, limit: 500 }) }),
);

adminRoutes.get("/queue", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, ts, due, attempts, error, job FROM outbox WHERE status = 'pending' ORDER BY id LIMIT 100",
  ).all<{ id: number; ts: number; due: number; attempts: number; error: string | null; job: string }>();
  return c.json({ pending: rows.results.map((r) => ({ ...r, job: JSON.parse(r.job) })) });
});

adminRoutes.post("/token/refresh", async (c) => c.json({ result: await refreshTokenIfNeeded(c.env, true) }));

adminRoutes.route("/setup", setupRoutes);
adminRoutes.route("/", accountRoutes);
adminRoutes.route("/rules", ruleRoutes);
