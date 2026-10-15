// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Onboarding: checklist, app credentials, token exchange and live checks. Used by the dashboard wizard, the CLI and the MCP tools.
import { Hono } from "hono";
import { saveAppCredentials } from "../../db/app-credentials";
import { parseBody } from "../../lib/validate";
import { authorizeUrl, exchangeAndConnect } from "../../services/oauth";
import { buildSetupReport, runSetupChecks } from "../../services/setup-status";
import type { AppEnv } from "../../types/app";
import { credentialsSchema, exchangeSchema, platformSchema } from "../schemas";

export const setupRoutes = new Hono<AppEnv>();

const originOf = (url: string) => new URL(url).origin;

setupRoutes.get("/", async (c) => c.json(await buildSetupReport(c.env, originOf(c.req.url))));

/** Calls Meta to confirm each token still works and which webhook fields are subscribed. */
setupRoutes.get("/checks", async (c) => c.json({ checks: await runSetupChecks(c.env) }));

setupRoutes.post("/credentials", async (c) => {
  const { platform, appId, appSecret } = await parseBody(c, credentialsSchema);
  await saveAppCredentials(c.env, platform, { id: appId, secret: appSecret });
  return c.json({ saved: true, platform });
});

setupRoutes.get("/oauth-url", async (c) => {
  const platform = platformSchema.parse(c.req.query("platform") ?? "instagram");
  return c.json({ platform, url: await authorizeUrl(c.env, platform, originOf(c.req.url)) });
});

setupRoutes.post("/exchange", async (c) => {
  const { platform, token } = await parseBody(c, exchangeSchema);
  return c.json({ platform, message: await exchangeAndConnect(c.env, platform, token) });
});
