// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Shapes of the Instagram webhook payloads we read (https://developers.facebook.com/docs/instagram-platform/webhooks).

export interface IgComment {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  /** Set on replies inside a comment thread. */
  parent_id?: string;
}

export interface IgMessage {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
}

export interface WebhookEntry {
  /** The Instagram account the event is for. */
  id?: string;
  time?: number;
  changes?: { field?: string; value?: IgComment }[];
  messaging?: IgMessage[];
}

export interface WebhookPayload {
  object?: string;
  entry?: WebhookEntry[];
}
