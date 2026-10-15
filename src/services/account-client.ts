// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// What each connected account can do, hiding the differences between Instagram Login, Facebook Login and Messenger.
import type { Account } from "../db/accounts";
import type { Env } from "../types/env";
import { DEFAULT_FACEBOOK_GRAPH, DEFAULT_GRAPH, Graph, type GraphResult, type ProfileResponse } from "./graph";

/** A person's profile, normalised across platforms. `following` is null when it cannot be checked. */
export interface Profile {
  name?: string;
  following: boolean | null;
}

/** Subscription fields per connection type. */
const SUBSCRIBE_FIELDS = {
  instagram_login: "comments,messages",
  facebook_login: "feed,messages,messaging_postbacks",
} as const;

export class AccountClient {
  readonly account: Account;
  readonly graph: Graph;

  constructor(account: Account, graph: Graph) {
    this.account = account;
    this.graph = graph;
  }

  private get messagesPath() {
    return `/${this.account.ownerId}/messages`;
  }

  /** One private reply per comment, within 7 days of it. Instagram and Messenger share the endpoint. */
  privateReply(commentId: string, text: string): Promise<GraphResult> {
    return this.graph.post(this.messagesPath, { recipient: { comment_id: commentId }, message: { text } });
  }

  /** A message to someone who wrote to the account in the last 24 hours. */
  dm(userId: string, text: string): Promise<GraphResult> {
    return this.graph.post(this.messagesPath, { recipient: { id: userId }, message: { text } });
  }

  /** A public reply under a comment. Instagram replies live at /replies, Facebook at /comments. */
  publicReply(commentId: string, text: string): Promise<GraphResult> {
    const edge = this.account.platform === "instagram" ? "replies" : "comments";
    return this.graph.post(`/${commentId}/${edge}`, { message: text });
  }

  /** Name and, on Instagram, whether they follow the account (only when Meta allows the check). */
  async profile(userId: string): Promise<Profile> {
    if (this.account.platform === "instagram") {
      const r = await this.graph.get<ProfileResponse>(`/${userId}?fields=name,username,is_user_follow_business`);
      if (!r.ok) return { following: null };
      const following = typeof r.data.is_user_follow_business === "boolean" ? r.data.is_user_follow_business : null;
      return { name: r.data.name?.split(" ")[0], following };
    }
    const r = await this.graph.get<{ first_name?: string; name?: string }>(`/${userId}?fields=first_name,name`);
    return { name: r.ok ? (r.data.first_name ?? r.data.name?.split(" ")[0]) : undefined, following: null };
  }

  /** Subscribes the app to this account's webhooks. */
  subscribe(): Promise<GraphResult> {
    const fields = SUBSCRIBE_FIELDS[this.account.mode];
    return this.graph.post(`/${this.account.ownerId}/subscribed_apps?subscribed_fields=${fields}`);
  }

  /** Which webhook fields the app is currently subscribed to for this account. */
  async subscribedFields(): Promise<GraphResult<string[]>> {
    const r = await this.graph.get<{ data?: { subscribed_fields?: string[] }[] }>(
      `/${this.account.ownerId}/subscribed_apps`,
    );
    return r.ok ? { ok: true, data: r.data.data?.flatMap((app) => app.subscribed_fields ?? []) ?? [] } : r;
  }
}

/** The Graph host for an account: graph.instagram.com for Instagram Login, graph.facebook.com otherwise. GRAPH_BASE overrides both (tests). */
export const graphBaseFor = (env: Env, account: Pick<Account, "mode">): string =>
  env.GRAPH_BASE || (account.mode === "instagram_login" ? DEFAULT_GRAPH : DEFAULT_FACEBOOK_GRAPH);

export const clientFor = (env: Env, account: Account): AccountClient =>
  new AccountClient(account, new Graph(account.token, graphBaseFor(env, account)));
