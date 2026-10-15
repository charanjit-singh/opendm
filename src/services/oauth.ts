// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// OAuth for both logins: Instagram Login (Instagram token) and Facebook Login (user token -> Page token).

import { saveAccount } from "../db/accounts";
import { getAppCredentials } from "../db/app-credentials";
import { makeToken } from "../lib/crypto";
import { ApiError } from "../lib/validate";
import type { Platform } from "../types/api";
import type { Env } from "../types/env";
import { connectFacebook } from "./facebook-setup";
import {
  DEFAULT_FACEBOOK_GRAPH,
  DEFAULT_GRAPH,
  DEFAULT_OAUTH,
  exchangeCode,
  exchangeForLongLived,
  facebookExchangeCode,
  facebookLongLived,
  Graph,
} from "./graph";

/** Permissions requested per login (https://developers.facebook.com/docs/permissions). */
export const SCOPES: Record<Platform, string> = {
  instagram: "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments",
  facebook:
    "pages_show_list,pages_manage_metadata,pages_messaging,pages_read_engagement,pages_manage_engagement,instagram_basic,instagram_manage_comments,instagram_manage_messages",
};

const STATE_TTL_SECONDS = 600;
const AUTHORIZE_URL: Record<Platform, string> = {
  instagram: "https://www.instagram.com/oauth/authorize",
  facebook: "https://www.facebook.com/dialog/oauth",
};

export const redirectUriFor = (origin: string) => `${origin}/admin/oauth/callback`;

/** The URL to send the user to. The `state` binds the round trip to this dashboard session. */
export async function authorizeUrl(env: Env, platform: Platform, origin: string): Promise<string> {
  const { id } = await getAppCredentials(env, platform);
  if (!id) throw new ApiError(400, `Enter the ${platform} app ID first (Setup, step 2)`);
  const params = new URLSearchParams({
    client_id: id,
    redirect_uri: redirectUriFor(origin),
    response_type: "code",
    scope: SCOPES[platform],
    state: await makeToken(env.SESSION_SECRET, `oauth:${platform}`, STATE_TTL_SECONDS),
  });
  return `${AUTHORIZE_URL[platform]}?${params}`;
}

/** Finishes the round trip: code -> long-lived token -> saved connection. Returns a message for the dashboard. */
export async function completeOAuth(env: Env, platform: Platform, code: string, origin: string): Promise<string> {
  const { id, secret } = await getAppCredentials(env, platform);
  if (!id || !secret) return `Enter the ${platform} app ID and secret first (Setup, step 2)`;
  const redirectUri = redirectUriFor(origin);
  return platform === "instagram"
    ? completeInstagram(env, { id, secret, redirectUri, code })
    : completeFacebook(env, { id, secret, redirectUri, code });
}

interface Exchange {
  id: string;
  secret: string;
  redirectUri: string;
  code: string;
}

async function completeInstagram(env: Env, x: Exchange): Promise<string> {
  const graphBase = env.GRAPH_BASE || DEFAULT_GRAPH;
  const short = await exchangeCode(env.OAUTH_BASE || DEFAULT_OAUTH, {
    clientId: x.id,
    clientSecret: x.secret,
    redirectUri: x.redirectUri,
    code: x.code,
  });
  if (!short.ok) return `Code exchange failed: ${short.error}`;
  const long = await exchangeForLongLived(graphBase, short.data.access_token, x.secret);
  const token = long.ok ? long.data.access_token : short.data.access_token;
  const me = await new Graph(token, graphBase).me();
  if (!me.ok) return `Could not read the account: ${me.error}`;
  await saveAccount(env, {
    token,
    igId: String(me.data.user_id ?? me.data.id ?? short.data.user_id),
    username: me.data.username,
    expiresInSec: long.ok ? long.data.expires_in : 3600,
  });
  return `Connected @${me.data.username ?? ""}`;
}

async function completeFacebook(env: Env, x: Exchange): Promise<string> {
  const base = env.GRAPH_BASE || DEFAULT_FACEBOOK_GRAPH;
  const user = await facebookExchangeCode(base, {
    clientId: x.id,
    clientSecret: x.secret,
    redirectUri: x.redirectUri,
    code: x.code,
  });
  if (!user.ok) return `Code exchange failed: ${user.error}`;
  const long = await facebookLongLived(base, x.id, x.secret, user.data.access_token);
  const result = await connectFacebook(env, long.ok ? long.data.access_token : user.data.access_token);
  return result.connected
    ? `Connected Facebook Page ${result.page.name}`
    : "Facebook connected: choose which Page to use (Setup, step 3)";
}

/** Upgrades a token the user pasted to a long-lived one where Meta supports it, then connects. Used by the CLI and MCP tools. */
export async function exchangeAndConnect(env: Env, platform: Platform, token: string): Promise<string> {
  const { id, secret } = await getAppCredentials(env, platform);
  if (platform === "instagram") {
    const graphBase = env.GRAPH_BASE || DEFAULT_GRAPH;
    const long = secret ? await exchangeForLongLived(graphBase, token, secret) : null;
    const finalToken = long?.ok ? long.data.access_token : token;
    const me = await new Graph(finalToken, graphBase).me();
    if (!me.ok) throw new ApiError(400, `Instagram rejected the token: ${me.error}`);
    await saveAccount(env, {
      token: finalToken,
      igId: String(me.data.user_id ?? me.data.id ?? ""),
      username: me.data.username,
      expiresInSec: long?.ok ? long.data.expires_in : undefined,
    });
    return `Connected @${me.data.username ?? ""}${long?.ok ? " (long-lived token, refreshed automatically)" : ""}`;
  }
  const base = env.GRAPH_BASE || DEFAULT_FACEBOOK_GRAPH;
  const long = id && secret ? await facebookLongLived(base, id, secret, token) : null;
  const result = await connectFacebook(env, long?.ok ? long.data.access_token : token);
  return result.connected
    ? `Connected Facebook Page ${result.page.name}`
    : "Token accepted: choose a Page with opendm_select_facebook_page";
}
