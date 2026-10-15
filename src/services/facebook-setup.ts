// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Connecting a Facebook Page: from a Page token, or from a user token plus a choice of Page.
import { getUserToken, savePage, saveUserToken } from "../db/accounts";
import { ApiError } from "../lib/validate";
import type { Env } from "../types/env";
import { DEFAULT_FACEBOOK_GRAPH, Graph } from "./graph";

export interface PageInfo {
  id: string;
  name: string;
  instagram?: { id: string; username?: string };
}

interface PageRow {
  id: string;
  name: string;
  access_token?: string;
  instagram_business_account?: { id: string; username?: string };
}

const PAGE_FIELDS = "id,name,access_token,instagram_business_account{id,username}";

const facebookGraph = (env: Env, token: string) => new Graph(token, env.GRAPH_BASE || DEFAULT_FACEBOOK_GRAPH);

const toInfo = (p: PageRow): PageInfo => ({ id: p.id, name: p.name, instagram: p.instagram_business_account });

export type ConnectResult =
  | { connected: true; page: PageInfo }
  /** A user token was given: the person must choose which Page to connect. */
  | { connected: false; needsPage: true; pages: PageInfo[] };

/** Saves one Page (its own access token) as the Facebook connection. */
async function saveChosen(env: Env, page: PageRow): Promise<ConnectResult> {
  if (!page.access_token)
    throw new ApiError(
      400,
      "Facebook did not return a Page token for that Page (manage the Page or ask for pages_show_list)",
    );
  await savePage(env, {
    token: page.access_token,
    pageId: page.id,
    name: page.name,
    igId: page.instagram_business_account?.id ?? null,
    igUsername: page.instagram_business_account?.username ?? null,
  });
  return { connected: true, page: toInfo(page) };
}

/** A user token's Pages. Empty for a Page token. */
async function pagesOf(env: Env, userToken: string): Promise<PageRow[]> {
  const result = await facebookGraph(env, userToken).get<{ data?: PageRow[] }>(`/me/accounts?fields=${PAGE_FIELDS}`);
  return result.ok ? (result.data.data ?? []) : [];
}

/** Accepts a Page token (connects right away) or a user token (connects the chosen Page, or asks which). */
export async function connectFacebook(env: Env, token: string, pageId?: string): Promise<ConnectResult> {
  const pages = await pagesOf(env, token);
  if (pages.length) {
    const chosen = pageId ? pages.find((p) => p.id === pageId) : pages.length === 1 ? pages[0] : undefined;
    if (chosen) return saveChosen(env, chosen);
    await saveUserToken(env, token);
    return { connected: false, needsPage: true, pages: pages.map(toInfo) };
  }
  const me = await facebookGraph(env, token).get<PageRow>(`/me?fields=id,name,instagram_business_account{id,username}`);
  if (!me.ok) throw new ApiError(400, `Facebook rejected the token: ${me.error}`);
  return saveChosen(env, { ...me.data, access_token: token });
}

export async function listPages(env: Env): Promise<PageInfo[]> {
  const userToken = await getUserToken(env);
  if (!userToken) throw new ApiError(400, "Connect with a Facebook user token first");
  return (await pagesOf(env, userToken)).map(toInfo);
}

export async function selectPage(env: Env, pageId: string): Promise<ConnectResult> {
  const userToken = await getUserToken(env);
  if (!userToken) throw new ApiError(400, "Connect with a Facebook user token first");
  const chosen = (await pagesOf(env, userToken)).find((p) => p.id === pageId);
  if (!chosen) throw new ApiError(404, "That Page is not available to this token");
  return saveChosen(env, chosen);
}
