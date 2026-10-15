// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Shapes the admin API returns. Shared by the Worker and the dashboard, so this file must stay free of Worker types.
import type { Flow, Step } from "../services/flow";

export type { Flow, Step };

export interface Rule {
  id: number;
  name: string;
  keywords: string[];
  media_id: string | null;
  enabled: boolean;
  link: string;
  public_replies: string[];
  fuzzy: boolean;
  /** The flow with defaults applied. */
  flow: Flow;
  /** The overrides as stored, so the editor shows what was actually set. */
  flow_raw: Record<string, unknown>;
}

export type EventKind = "comment" | "dm" | "system" | "auth";
export type EventStatus = "sent" | "queued" | "skipped" | "error" | "info";

export interface EventRow {
  id: number;
  ts: number;
  kind: EventKind;
  status: EventStatus;
  ig_user: string | null;
  username: string | null;
  comment_id: string | null;
  rule_id: number | null;
  keyword: string | null;
  text: string | null;
  error: string | null;
}

export interface Status {
  enabled: boolean;
  connected: boolean;
  username: string | null;
  igId: string | null;
  tokenError: string | null;
  tokenExpires: number | null;
  webhookUrl: string;
  verifyTokenSet: boolean;
  oauthAvailable: boolean;
  rules: number;
  sent24h: number;
  sentLastHour: number;
  hourlyLimit: number;
  /** Conversation counts by step. */
  conversations: Partial<Record<Step, number>>;
  defaults: { flow: Flow; publicReplies: string[] };
}

export interface TranscriptLine {
  from: "user" | "bot" | "public" | "system";
  text: string;
  note?: string;
}

export type DryRunResult =
  | { matched: false; transcript: TranscriptLine[] }
  | { matched: true; rule: { id: number; name: string }; finalStep: Step; transcript: TranscriptLine[] };
