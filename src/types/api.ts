// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Shapes the admin API returns. Shared by the Worker and the dashboard, so this file must stay free of Worker types.
import type { Flow, Step } from "../services/flow";

export type { Flow, Step };

/** The two messaging platforms. A rule can target either or both. */
export type Platform = "instagram" | "facebook";
export type Channel = Platform | "both";

/** How the account is connected: Instagram Login (Instagram token) or Facebook Login (Page token). */
export type LoginMode = "instagram_login" | "facebook_login";

export interface Rule {
  id: number;
  name: string;
  keywords: string[];
  media_id: string | null;
  enabled: boolean;
  link: string;
  public_replies: string[];
  fuzzy: boolean;
  /** Where the rule fires. */
  channel: Channel;
  /** Also start the flow when someone sends the keyword as a direct message. */
  dm_trigger: boolean;
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
  /** e.g. "openerText#2/3": which wording of a message was sent. */
  variant: string | null;
  platform: Platform | null;
}

export interface ChannelStatus {
  connected: boolean;
  mode: LoginMode | null;
  /** Instagram username, or the Facebook Page name. */
  name: string | null;
  id: string | null;
  tokenError: string | null;
}

export interface Status {
  enabled: boolean;
  /** Instagram connected (kept for older clients; see `channels`). */
  connected: boolean;
  username: string | null;
  igId: string | null;
  channels: { instagram: ChannelStatus; facebook: ChannelStatus };
  tokenError: string | null;
  tokenExpires: number | null;
  webhookUrl: string;
  verifyTokenSet: boolean;
  /** The webhook verify token, for pasting into Meta (admin only). */
  verifyToken: string;
  oauthAvailable: boolean;
  facebookOauthAvailable: boolean;
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

export type SetupStatusLevel = "ok" | "todo" | "warn" | "info";

export interface SetupStep {
  id: "server" | "app" | "connect" | "token" | "webhook" | "events" | "rule" | "comment" | "review";
  title: string;
  status: SetupStatusLevel;
  /** What the check found, in a sentence. */
  detail: string;
  /** What to do next when the step is not done. */
  help?: string;
  /** True when a person has to act (log in, create the Meta app, comment from another account). */
  needsHuman?: boolean;
}

export interface SetupReport {
  steps: SetupStep[];
  /** The first step that is not done, or null when everything is. */
  next: SetupStep | null;
  /** Everything needed for live traffic is in place. */
  ready: boolean;
}

export interface SetupCheck {
  name: string;
  ok: boolean;
  detail: string;
}
