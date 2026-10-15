// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Thin client for the Instagram API with Instagram Login (graph.instagram.com).
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/

import type { Account } from "../db/accounts";
import { scrub } from "../lib/crypto";
import type { Env } from "../types/env";

export const GRAPH_VERSION = "v25.0";
export const DEFAULT_GRAPH = "https://graph.instagram.com";
export const DEFAULT_FACEBOOK_GRAPH = "https://graph.facebook.com";
export const DEFAULT_OAUTH = "https://api.instagram.com";

export type ErrorKind = "retry" | "token" | "permission" | "final";
export type GraphResult<T = unknown> =
  | { ok: true; data: T }
  | { ok: false; status: number; code?: number; kind: ErrorKind; error: string };

interface GraphError {
  code?: number;
  message?: string;
}

/**
 * What to do with a failed call (https://developers.facebook.com/docs/graph-api/guides/error-handling/):
 *  retry = throttled or transient (2/4/17/32/341/613/80002-80006, HTTP 429/5xx): back off, try again
 *  token = the access token is bad or expired (190, 102, 463, 467): stop and flag the account
 *  permission = missing permission or not allowed (10, 200-299, 3): do not retry
 *  final = anything else (user cannot be messaged, comment already replied to...): do not retry
 */
export function classify(status: number, err?: GraphError): ErrorKind {
  const c = err?.code;
  if (c === 190 || c === 102 || c === 463 || c === 467) return "token";
  if (c === 10 || c === 3 || (c !== undefined && c >= 200 && c <= 299)) return "permission";
  if (c !== undefined && [2, 4, 17, 32, 341, 613].includes(c)) return "retry";
  if (c !== undefined && c >= 80002 && c <= 80006) return "retry";
  if (status === 429 || status >= 500) return "retry";
  return "final";
}

interface GraphBody {
  error?: GraphError;
}

/** One HTTP call to the Graph API. Failures come back as a classified result, never as an exception. */
async function graphFetch<T>(url: string, init: RequestInit, token: string | null): Promise<GraphResult<T>> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  let response: Response;
  try {
    response = await fetch(url, { ...init, headers });
  } catch (e) {
    return { ok: false, status: 0, kind: "retry", error: scrub(`network error: ${(e as Error).message}`, [token]) };
  }
  const data = (await response.json().catch(() => ({}))) as GraphBody & T;
  if (response.ok && !data.error) return { ok: true, data };
  const error = data.error ?? {};
  return {
    ok: false,
    status: response.status,
    code: error.code,
    kind: classify(response.status, error),
    error: scrub(error.message ?? `HTTP ${response.status}`, [token]),
  };
}

const trimSlash = (base: string) => base.replace(/\/$/, "");

export interface MeResponse {
  user_id?: string;
  id?: string;
  username?: string;
}

export interface ProfileResponse {
  name?: string;
  username?: string;
  /** Only present when Meta allows the follow check for this user. */
  is_user_follow_business?: boolean;
}

export interface TokenResponse {
  access_token: string;
  expires_in: number;
}

/** A thin client for one Graph host and one access token. Platform-specific calls live in account-client.ts. */
export class Graph {
  private readonly token: string;
  private readonly base: string;

  constructor(token: string, base = DEFAULT_GRAPH) {
    this.token = token;
    this.base = base;
  }

  private url = (path: string) => `${trimSlash(this.base)}/${GRAPH_VERSION}${path}`;

  get<T = unknown>(path: string) {
    return graphFetch<T>(this.url(path), {}, this.token);
  }

  post<T = unknown>(path: string, body?: unknown) {
    return graphFetch<T>(
      this.url(path),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      this.token,
    );
  }

  /** The Instagram account behind an Instagram Login token. */
  me() {
    return this.get<MeResponse>("/me?fields=user_id,username,account_type");
  }

  /** Extends an Instagram long-lived token by another 60 days (the token must be 24h+ old). */
  refresh() {
    const query = new URLSearchParams({ grant_type: "ig_refresh_token", access_token: this.token });
    return graphFetch<TokenResponse>(`${trimSlash(this.base)}/refresh_access_token?${query}`, {}, null);
  }
}

export interface CodeExchange {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}

/** Instagram OAuth: authorization code -> short-lived token. */
export async function exchangeCode(oauthBase: string, p: CodeExchange) {
  const form = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: p.redirectUri,
    code: p.code,
  });
  type Response = {
    access_token: string;
    user_id: string | number;
    data?: { access_token: string; user_id: string | number }[];
  };
  const result = await graphFetch<Response>(
    `${trimSlash(oauthBase)}/oauth/access_token`,
    { method: "POST", body: form },
    null,
  );
  return result.ok ? ({ ok: true, data: result.data.data?.[0] ?? result.data } as const) : result;
}

/** Instagram: short-lived token -> long-lived (60 day) token. */
export function exchangeForLongLived(base: string, shortToken: string, clientSecret: string) {
  const query = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: clientSecret,
    access_token: shortToken,
  });
  return graphFetch<TokenResponse>(`${trimSlash(base)}/access_token?${query}`, {}, null);
}

/** Facebook OAuth: authorization code -> user token. */
export function facebookExchangeCode(base: string, p: CodeExchange) {
  const query = new URLSearchParams({
    client_id: p.clientId,
    client_secret: p.clientSecret,
    redirect_uri: p.redirectUri,
    code: p.code,
  });
  return graphFetch<{ access_token: string; expires_in?: number }>(
    `${trimSlash(base)}/${GRAPH_VERSION}/oauth/access_token?${query}`,
    {},
    null,
  );
}

/** Facebook: user token -> long-lived user token (Page tokens made from it do not expire). */
export function facebookLongLived(base: string, appId: string, appSecret: string, userToken: string) {
  const query = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: userToken,
  });
  return graphFetch<{ access_token: string; expires_in?: number }>(
    `${trimSlash(base)}/${GRAPH_VERSION}/oauth/access_token?${query}`,
    {},
    null,
  );
}
