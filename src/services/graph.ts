// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Thin client for the Instagram API with Instagram Login (graph.instagram.com).
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/

import type { Account } from "../db/account";
import { scrub } from "../lib/crypto";
import type { Env } from "../types/env";

export const GRAPH_VERSION = "v25.0";
export const DEFAULT_GRAPH = "https://graph.instagram.com";
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

/** Client for the connected account's Instagram token. */
export class Graph {
  constructor(
    private readonly token: string,
    private readonly base = DEFAULT_GRAPH,
  ) {}

  private url = (path: string) => `${trimSlash(this.base)}/${GRAPH_VERSION}${path}`;

  private get<T>(path: string) {
    return graphFetch<T>(this.url(path), {}, this.token);
  }

  private post(path: string, body?: unknown) {
    return graphFetch<unknown>(
      this.url(path),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      },
      this.token,
    );
  }

  /** The account behind the token. */
  me() {
    return this.get<MeResponse>("/me?fields=user_id,username,account_type");
  }

  /** One private reply per comment, within 7 days of the comment. */
  privateReply(igId: string, commentId: string, text: string) {
    return this.post(`/${igId}/messages`, { recipient: { comment_id: commentId }, message: { text } });
  }

  /** A DM to someone who messaged the account in the last 24 hours. */
  sendDm(igId: string, userId: string, text: string) {
    return this.post(`/${igId}/messages`, { recipient: { id: userId }, message: { text } });
  }

  publicReply(commentId: string, text: string) {
    return this.post(`/${commentId}/replies`, { message: text });
  }

  /** Profile of someone who messaged us. */
  profile(userId: string) {
    return this.get<ProfileResponse>(`/${userId}?fields=name,username,is_user_follow_business`);
  }

  /** Subscribes the app to this account's comments + messages webhooks. */
  subscribe(igId: string) {
    return this.post(`/${igId}/subscribed_apps?subscribed_fields=comments,messages`);
  }

  /** Extends a long-lived token by another 60 days (the token must be 24h+ old). */
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

/** OAuth: authorization code -> short-lived token. */
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

/** OAuth: short-lived token -> long-lived (60 day) token. */
export function exchangeForLongLived(base: string, shortToken: string, clientSecret: string) {
  const query = new URLSearchParams({
    grant_type: "ig_exchange_token",
    client_secret: clientSecret,
    access_token: shortToken,
  });
  return graphFetch<TokenResponse>(`${trimSlash(base)}/access_token?${query}`, {}, null);
}

/** A client for the connected account, honouring the GRAPH_BASE override used by tests. */
export const graphClientFor = (env: Env, account: Account): Graph =>
  new Graph(account.token, env.GRAPH_BASE || DEFAULT_GRAPH);
