// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { getCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { readToken } from "../lib/crypto";
import { clientIp, SESSION_COOKIE } from "../lib/http";
import { checkAdminPassword } from "../services/admin-auth";
import type { AppEnv } from "../types/app";

/**
 * Guards the admin API. Two ways in:
 *  - the session cookie from the dashboard login (writes must be JSON, which blocks cross-site form posts), or
 *  - `Authorization: Bearer <ADMIN_PASSWORD>`, for scripts, the CLI and the MCP server.
 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  const bearer = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (bearer) {
    const check = await checkAdminPassword(c.env, clientIp(c), bearer);
    if (!check.ok) return c.json({ error: check.error }, check.status);
    return next();
  }
  if ((await readToken(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE))) !== "admin") {
    return c.json({ error: "Not logged in" }, 401);
  }
  const hasJson = (c.req.header("Content-Type") ?? "").includes("application/json");
  if (c.req.method !== "GET" && !hasJson) return c.json({ error: "JSON body required" }, 415);
  return next();
});
