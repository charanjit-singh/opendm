// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// "Connect with Instagram": the Instagram Login OAuth hand-off. The dashboard session guards it.
import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { saveAccount } from "../db/account";
import { makeToken, readToken } from "../lib/crypto";
import { SESSION_COOKIE } from "../lib/http";
import { ApiError } from "../lib/validate";
import { DEFAULT_GRAPH, DEFAULT_OAUTH, exchangeCode, exchangeForLongLived, Graph } from "../services/graph";
import type { AppEnv } from "../types/app";

export const oauthRoutes = new Hono<AppEnv>();

const SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments";
const STATE_TTL_SECONDS = 600;

oauthRoutes.use("*", async (c, next) => {
  const loggedIn = (await readToken(c.env.SESSION_SECRET, getCookie(c, SESSION_COOKIE))) === "admin";
  return loggedIn ? next() : c.redirect("/admin", 302);
});

oauthRoutes.get("/start", async (c) => {
  if (!c.env.INSTAGRAM_APP_ID) throw new ApiError(400, "Set INSTAGRAM_APP_ID to use OAuth");
  const params = new URLSearchParams({
    client_id: c.env.INSTAGRAM_APP_ID,
    redirect_uri: new URL("/admin/oauth/callback", c.req.url).href,
    response_type: "code",
    scope: SCOPES,
    state: await makeToken(c.env.SESSION_SECRET, "oauth", STATE_TTL_SECONDS),
  });
  return c.redirect(`https://www.instagram.com/oauth/authorize?${params}`, 302);
});

oauthRoutes.get("/callback", async (c) => {
  const backToDashboard = (message: string) => c.redirect(`/admin#${encodeURIComponent(message)}`, 302);
  if ((await readToken(c.env.SESSION_SECRET, c.req.query("state"))) !== "oauth") {
    return backToDashboard("OAuth state invalid or expired, try again");
  }
  // Instagram appends "#_" to the code.
  const code = (c.req.query("code") ?? "").replace(/#_$/, "");
  if (!code) return backToDashboard(`Instagram said: ${c.req.query("error_description") ?? "no code"}`);

  const graphBase = c.env.GRAPH_BASE || DEFAULT_GRAPH;
  const short = await exchangeCode(c.env.OAUTH_BASE || DEFAULT_OAUTH, {
    clientId: c.env.INSTAGRAM_APP_ID ?? "",
    clientSecret: c.env.INSTAGRAM_APP_SECRET,
    redirectUri: new URL("/admin/oauth/callback", c.req.url).href,
    code,
  });
  if (!short.ok) return backToDashboard(`Code exchange failed: ${short.error}`);
  const long = await exchangeForLongLived(graphBase, short.data.access_token, c.env.INSTAGRAM_APP_SECRET);
  const token = long.ok ? long.data.access_token : short.data.access_token;
  const me = await new Graph(token, graphBase).me();
  if (!me.ok) return backToDashboard(`Could not read the account: ${me.error}`);
  await saveAccount(c.env, {
    token,
    igId: String(me.data.user_id ?? me.data.id ?? short.data.user_id),
    username: me.data.username,
    expiresInSec: long.ok ? long.data.expires_in : 3600,
  });
  return backToDashboard(`Connected @${me.data.username ?? ""}`);
});
