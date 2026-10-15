// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Shapes of the webhook payloads we read.
// Instagram: https://developers.facebook.com/docs/instagram-platform/webhooks
// Facebook Pages: https://developers.facebook.com/docs/graph-api/webhooks/reference/page

export interface IgComment {
  id: string;
  text?: string;
  from?: { id?: string; username?: string };
  media?: { id?: string; media_product_type?: string };
  /** Set on replies inside a comment thread. */
  parent_id?: string;
}

/** A Page "feed" change. Only `item: "comment"` with `verb: "add"` matters here. */
export interface FbFeedValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  post_id?: string;
  /** For a top-level comment this is the post id; for a reply it is the parent comment id. */
  parent_id?: string;
  message?: string;
  from?: { id?: string; name?: string };
}

export interface IgMessage {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
}

export interface WebhookEntry {
  /** The Instagram account or Facebook Page the event is for. */
  id?: string;
  time?: number;
  changes?: { field?: string; value?: IgComment & FbFeedValue }[];
  messaging?: IgMessage[];
}

export interface WebhookPayload {
  /** "instagram" or "page". */
  object?: string;
  entry?: WebhookEntry[];
}

/** A comment from either platform in one shape. */
export interface InboundComment {
  id: string;
  text: string;
  fromId?: string;
  fromName?: string;
  mediaId?: string;
  isReply: boolean;
}
