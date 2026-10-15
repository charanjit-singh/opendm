// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// OpenDM: Instagram comment-to-DM automation on Cloudflare Workers. https://github.com/charanjit-singh/opendm
import { Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import { ensureSchema } from "./db/schema";
import { ApiError } from "./lib/validate";
import { adminRoutes } from "./routes/admin";
import { authRoutes } from "./routes/auth";
import { oauthRoutes } from "./routes/oauth";
import { webhookRoutes } from "./routes/webhook";
import { runCron } from "./services/cron";
import type { AppEnv } from "./types/app";
import type { Env } from "./types/env";

const VERSION = "0.1.0";

const app = new Hono<AppEnv>();

app.use("*", secureHeaders());
app.get("/health", (c) => c.json({ ok: true, name: "opendm", version: VERSION }));
app.get("/favicon.ico", (c) => c.body(null, 204));

// Everything below touches D1, so make sure the schema exists first (a no-op after the first request).
app.use("*", async (c, next) => {
  await ensureSchema(c.env.DB);
  await next();
});

app.route("/webhook", webhookRoutes);
app.route("/api", authRoutes);
app.route("/api", adminRoutes);
app.route("/admin/oauth", oauthRoutes);

app.notFound((c) => c.text("Not found", 404));
app.onError((error, c) => {
  if (error instanceof ApiError) return c.json({ error: error.message }, error.status);
  console.error(error);
  return c.json({ error: "Server error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runCron(env)));
  },
} satisfies ExportedHandler<Env>;
