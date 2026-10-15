// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// "Connect with Instagram" / "Connect with Facebook": the OAuth hand-off. The dashboard session guards it.
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { readToken } from "../lib/crypto";
import { SESSION_COOKIE } from "../lib/http";
import { authorizeUrl, completeOAuth } from "../services/oauth";
import type { Platform } from "../types/api";
import type { AppEnv } from "../types/app";

export const oauthRoutes = new Hono<AppEnv>();

oauthRoutes.use("*", async (c, next) => {
  const loggedIn = (await readToken(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE))) === "admin";
  return loggedIn ? next() : c.redirect("/admin", 302);
});

oauthRoutes.get("/start", async (c) => {
  const platform: Platform = c.req.query("platform") === "facebook" ? "facebook" : "instagram";
  return c.redirect(await authorizeUrl(c.env, platform, new URL(c.req.url).origin), 302);
});

oauthRoutes.get("/callback", async (c) => {
  const backToDashboard = (message: string) => c.redirect(`/admin#${encodeURIComponent(message)}`, 302);
  const state = await readToken(c.env.SESSION_SECRET, c.req.query("state"));
  const platform = state?.startsWith("oauth:") ? (state.slice(6) as Platform) : null;
  if (platform !== "instagram" && platform !== "facebook")
    return backToDashboard("OAuth state invalid or expired, try again");
  // Instagram appends "#_" to the code.
  const code = (c.req.query("code") ?? "").replace(/#_$/, "");
  if (!code) return backToDashboard(`Instagram said: ${c.req.query("error_description") ?? "no code"}`);
  return backToDashboard(await completeOAuth(c.env, platform, code, new URL(c.req.url).origin));
});
