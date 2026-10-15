// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// A small typed client for the OpenDM admin API, shared by the CLI, the stdio MCP server and the Worker's own /mcp endpoint.
// Relative imports use .ts extensions on purpose: Node runs this folder directly (type stripping).
import type {
  Channel,
  ChannelStatus,
  DryRunResult,
  EventRow,
  Platform,
  Rule,
  SetupCheck,
  SetupReport,
  Status,
} from "../types/api.ts";

export class OpenDmError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

/** The rule fields as the API takes them. */
export interface RulePayload {
  name?: string;
  keywords: string[];
  link?: string;
  media_id?: string | null;
  enabled?: boolean;
  fuzzy?: boolean;
  channel?: Channel;
  dm_trigger?: boolean;
  public_replies?: string[];
  flow?: Record<string, unknown>;
}

export interface DryRunPayload {
  comment: string;
  platform?: Platform;
  variant?: number;
  name?: string;
  replies?: string[];
  following?: "yes" | "no" | "unknown";
  waitMinutes?: number;
}

export interface Conversation {
  id: number;
  ig_user: string;
  username: string | null;
  platform: Platform;
  rule_id: number;
  rule_name: string | null;
  step: string;
  email: string | null;
  started: number;
  updated: number;
}

export interface PageInfo {
  id: string;
  name: string;
  instagram?: { id: string; username?: string };
}

export type ConnectFacebookResult =
  | { connected: true; page: PageInfo }
  | { connected: false; needsPage: true; pages: PageInfo[] };

/** Which fetch to use: the global one, or the Worker's own app when running inside it. */
export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class OpenDmClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: FetchLike;

  constructor(baseUrl: string, token: string, fetchImpl: FetchLike = (input, init) => fetch(input, init)) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(method: string, path: string, body?: unknown, auth = true): Promise<T> {
    const headers: Record<string, string> = auth ? { Authorization: `Bearer ${this.token}` } : {};
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    if (!response.ok) throw new OpenDmError(data.error ?? `HTTP ${response.status}`, response.status);
    return data as T;
  }

  health() {
    return this.request<{ ok: boolean; name: string; version: string }>("GET", "/health", undefined, false);
  }

  status() {
    return this.request<Status>("GET", "/api/status");
  }

  setEnabled(enabled: boolean) {
    return this.request<{ enabled: boolean }>("POST", "/api/enabled", { enabled });
  }

  setHourlyLimit(hourlyLimit: number) {
    return this.request<{ hourlyLimit: number }>("POST", "/api/settings", { hourlyLimit });
  }

  // ---- accounts and setup ------------------------------------------------------------------------------------
  connect(token: string) {
    return this.request<{ connected: true; username: string | null; igId: string }>("POST", "/api/connect", { token });
  }

  disconnect(platform: Platform) {
    return this.request<{ connected: false }>("POST", "/api/disconnect", { platform });
  }

  subscribe(platform: Platform) {
    return this.request<{ subscribed: true }>("POST", "/api/subscribe", { platform });
  }

  connectFacebook(token: string, pageId?: string) {
    return this.request<ConnectFacebookResult>("POST", "/api/facebook/connect", { token, pageId });
  }

  async facebookPages() {
    return (await this.request<{ pages: PageInfo[] }>("GET", "/api/facebook/pages")).pages;
  }

  selectFacebookPage(pageId: string) {
    return this.request<ConnectFacebookResult>("POST", "/api/facebook/select", { pageId });
  }

  setupReport() {
    return this.request<SetupReport>("GET", "/api/setup");
  }

  async setupChecks() {
    return (await this.request<{ checks: SetupCheck[] }>("GET", "/api/setup/checks")).checks;
  }

  setAppCredentials(platform: Platform, appId: string, appSecret?: string) {
    return this.request<{ saved: true }>("POST", "/api/setup/credentials", { platform, appId, appSecret });
  }

  oauthUrl(platform: Platform) {
    return this.request<{ url: string }>("GET", `/api/setup/oauth-url?platform=${platform}`);
  }

  exchangeToken(platform: Platform, token: string) {
    return this.request<{ message: string }>("POST", "/api/setup/exchange", { platform, token });
  }

  refreshToken() {
    return this.request<{ result: string }>("POST", "/api/token/refresh", {});
  }

  // ---- rules ---------------------------------------------------------------------------------------------------
  async listRules() {
    return (await this.request<{ rules: Rule[] }>("GET", "/api/rules")).rules;
  }

  async getRule(id: number) {
    return (await this.request<{ rule: Rule }>("GET", `/api/rules/${id}`)).rule;
  }

  async createRule(rule: RulePayload) {
    return (await this.request<{ rule: Rule }>("POST", "/api/rules", rule)).rule;
  }

  async replaceRule(id: number, rule: RulePayload) {
    return (await this.request<{ rule: Rule }>("PUT", `/api/rules/${id}`, rule)).rule;
  }

  deleteRule(id: number) {
    return this.request<{ deleted: number }>("DELETE", `/api/rules/${id}`);
  }

  dryRun(input: DryRunPayload) {
    return this.request<DryRunResult>("POST", "/api/test", input);
  }

  // ---- activity ------------------------------------------------------------------------------------------------
  async log(limit = 30, kind?: string) {
    const query = new URLSearchParams({ limit: String(limit), ...(kind ? { kind } : {}) });
    return (await this.request<{ events: EventRow[] }>("GET", `/api/log?${query}`)).events;
  }

  async conversations(step?: string, limit = 50) {
    const query = new URLSearchParams({ limit: String(limit), ...(step ? { step } : {}) });
    return (await this.request<{ conversations: Conversation[] }>("GET", `/api/conversations?${query}`)).conversations;
  }

  async leads() {
    return (await this.request<{ leads: Conversation[] }>("GET", "/api/leads")).leads;
  }

  async queue() {
    return (
      await this.request<{
        pending: {
          id: number;
          due: number;
          attempts: number;
          error: string | null;
          job: { kind: string; platform: string; text: string };
        }[];
      }>("GET", "/api/queue")
    ).pending;
  }
}

/** Builds a client from OPENDM_URL and OPENDM_TOKEN (the admin password). */
export function clientFromEnv(env: Record<string, string | undefined> = process.env): OpenDmClient {
  const url = env.OPENDM_URL;
  const token = env.OPENDM_TOKEN;
  if (!url || !token) {
    throw new Error("Set OPENDM_URL (https://<your-worker>.workers.dev) and OPENDM_TOKEN (your ADMIN_PASSWORD).");
  }
  return new OpenDmClient(url, token);
}

export type { ChannelStatus };
