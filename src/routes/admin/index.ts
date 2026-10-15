// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { recentEvents } from "../../db/events";
import { isEnabled, SETTING, setSetting } from "../../db/settings";
import { requireAdmin } from "../../middleware/admin-auth";
import { parseBody } from "../../lib/validate";
import { dryRun } from "../../services/dry-run";
import { buildStatus } from "../../services/status";
import type { AppEnv } from "../../types/app";
import { dryRunSchema, enabledSchema, settingsSchema } from "../schemas";
import { accountRoutes } from "./account";
import { ruleRoutes } from "./rules";

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

adminRoutes.route("/", accountRoutes);
adminRoutes.route("/rules", ruleRoutes);
