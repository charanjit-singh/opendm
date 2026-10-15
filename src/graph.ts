// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Thin client for the Instagram API with Instagram Login (graph.instagram.com).
// https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/
import { scrub } from "./crypto";

export const GRAPH_VERSION = "v25.0";
export const DEFAULT_GRAPH = "https://graph.instagram.com";
export const DEFAULT_OAUTH = "https://api.instagram.com";

export type ErrorKind = "retry" | "token" | "permission" | "final";
export type GraphResult<T = any> = { ok: true; data: T } | { ok: false; status: number; code?: number; kind: ErrorKind; error: string };

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

export class Graph {
  constructor(
    private token: string,
    private base = DEFAULT_GRAPH,
    private oauthBase = DEFAULT_OAUTH,
  ) {}

  private versioned = (path: string) => `${this.base.replace(/\/$/, "")}/${GRAPH_VERSION}${path}`;

  private async call<T = any>(url: string, init: RequestInit = {}, bearer = true): Promise<GraphResult<T>> {
    const headers = new Headers(init.headers);
    if (bearer) headers.set("Authorization", `Bearer ${this.token}`);
    let res: Response;
    try {
      res = await fetch(url, { ...init, headers });
    } catch (e) {
      return { ok: false, status: 0, kind: "retry", error: scrub(`network error: ${(e as Error).message}`, [this.token]) };
    }
    const data: any = await res.json().catch(() => ({}));
    if (res.ok && !data?.error) return { ok: true, data };
    const err: GraphError = data?.error ?? {};
    return { ok: false, status: res.status, code: err.code, kind: classify(res.status, err), error: scrub(err.message ?? `HTTP ${res.status}`, [this.token]) };
  }

  private post(path: string, body: unknown) {
    return this.call(this.versioned(path), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  }

  /** The account behind the token: { user_id, username }. */
  me() {
    return this.call<{ user_id?: string; id?: string; username?: string }>(this.versioned("/me?fields=user_id,username,account_type"));
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

  /** Profile of someone who messaged us. is_user_follow_business is only present when Meta allows it. */
  profile(userId: string) {
    return this.call<{ name?: string; username?: string; is_user_follow_business?: boolean }>(this.versioned(`/${userId}?fields=name,username,is_user_follow_business`));
  }

  /** Subscribes the app to this account's comments + messages webhooks. */
  subscribe(igId: string) {
    return this.call(this.versioned(`/${igId}/subscribed_apps?subscribed_fields=comments,messages`), { method: "POST" });
  }

  /** Extends a long-lived token by another 60 days (must be 24h+ old). */
  refresh() {
    return this.call<{ access_token: string; expires_in: number }>(`${this.base.replace(/\/$/, "")}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(this.token)}`, {}, false);
  }

  /** OAuth: authorization code -> short-lived token. */
  static async exchangeCode(oauthBase: string, p: { clientId: string; clientSecret: string; redirectUri: string; code: string }): Promise<GraphResult<{ access_token: string; user_id: string | number }>> {
    const form = new URLSearchParams({ client_id: p.clientId, client_secret: p.clientSecret, grant_type: "authorization_code", redirect_uri: p.redirectUri, code: p.code });
    const g = new Graph("", DEFAULT_GRAPH, oauthBase);
    const r = await g.call<any>(`${oauthBase.replace(/\/$/, "")}/oauth/access_token`, { method: "POST", body: form }, false);
    return r.ok ? { ok: true, data: r.data?.data?.[0] ?? r.data } : r;
  }

  /** OAuth: short-lived token -> long-lived (60 day) token. */
  static async longLived(base: string, shortToken: string, clientSecret: string): Promise<GraphResult<{ access_token: string; expires_in: number }>> {
    const g = new Graph(shortToken, base);
    return g.call(`${base.replace(/\/$/, "")}/access_token?grant_type=ig_exchange_token&client_secret=${encodeURIComponent(clientSecret)}&access_token=${encodeURIComponent(shortToken)}`, {}, false);
  }
}
