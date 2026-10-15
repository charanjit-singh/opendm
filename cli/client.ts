// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// A small typed client for the OpenDM admin API, shared by the CLI and the MCP server.
import type { DryRunResult, EventRow, Rule, Status } from "../src/types/api.ts";

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
  public_replies?: string[];
  flow?: Record<string, unknown>;
}

export interface DryRunPayload {
  comment: string;
  name?: string;
  replies?: string[];
  following?: "yes" | "no" | "unknown";
  waitMinutes?: number;
}

export class OpenDmClient {
  readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(baseUrl: string, token: string, fetchImpl: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
    this.fetchImpl = fetchImpl;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = { Authorization: `Bearer ${this.token}` };
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

  status() {
    return this.request<Status>("GET", "/api/status");
  }

  setEnabled(enabled: boolean) {
    return this.request<{ enabled: boolean }>("POST", "/api/enabled", { enabled });
  }

  setHourlyLimit(hourlyLimit: number) {
    return this.request<{ hourlyLimit: number }>("POST", "/api/settings", { hourlyLimit });
  }

  connect(token: string) {
    return this.request<{ connected: true; username: string | null; igId: string }>("POST", "/api/connect", { token });
  }

  subscribe() {
    return this.request<{ subscribed: true }>("POST", "/api/subscribe", {});
  }

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

  async log(limit = 30, kind?: string) {
    const query = new URLSearchParams({ limit: String(limit), ...(kind ? { kind } : {}) });
    return (await this.request<{ events: EventRow[] }>("GET", `/api/log?${query}`)).events;
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
