// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { DryRunResult, EventRow, Rule, Status } from "../../src/types/api";

/** An API error carrying the HTTP status, so callers can react to 401. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

let unauthorizedHandler: () => void = () => {};

/** Called when any request (other than login) comes back 401, so the app can show the login form. */
export const onUnauthorized = (handler: () => void) => {
  unauthorizedHandler = handler;
};

type Method = "GET" | "POST" | "PUT" | "DELETE";

async function request<T>(method: Method, path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: method === "GET" ? {} : { "Content-Type": "application/json" },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
  });
  const data = await response.json().catch(() => ({}));
  if (response.status === 401 && path !== "/api/login") unauthorizedHandler();
  if (!response.ok) throw new ApiError(data.error ?? `HTTP ${response.status}`, response.status);
  return data as T;
}

/** The rule fields the editor sends. */
export type RuleInput = Omit<Rule, "id" | "flow" | "flow_raw"> & { flow: Record<string, unknown> };

export interface DryRunRequest {
  comment: string;
  name: string;
  replies: string;
  following: "yes" | "no" | "unknown";
  waitMinutes: number;
}

export const api = {
  login: (password: string) => request<{ ok: true }>("POST", "/api/login", { password }),
  logout: () => request<{ ok: true }>("POST", "/api/logout"),
  status: () => request<Status>("GET", "/api/status"),
  setEnabled: (enabled: boolean) => request<{ enabled: boolean }>("POST", "/api/enabled", { enabled }),
  setHourlyLimit: (hourlyLimit: number) => request<{ hourlyLimit: number }>("POST", "/api/settings", { hourlyLimit }),
  connect: (token: string) => request<{ username: string | null }>("POST", "/api/connect", { token }),
  disconnect: () => request<{ connected: false }>("POST", "/api/disconnect"),
  subscribe: () => request<{ subscribed: true }>("POST", "/api/subscribe"),
  listRules: () => request<{ rules: Rule[] }>("GET", "/api/rules"),
  createRule: (rule: RuleInput) => request<{ rule: Rule }>("POST", "/api/rules", rule),
  updateRule: (id: number, rule: RuleInput) => request<{ rule: Rule }>("PUT", `/api/rules/${id}`, rule),
  deleteRule: (id: number) => request<{ deleted: number }>("DELETE", `/api/rules/${id}`),
  dryRun: (input: DryRunRequest) => request<DryRunResult>("POST", "/api/test", input),
  log: (limit = 100) => request<{ events: EventRow[] }>("GET", `/api/log?limit=${limit}`),
};
