// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { clearAccount, clearPage, getAccount, saveAccount } from "../../db/accounts";
import { logEvent } from "../../db/events";
import { setSetting } from "../../db/settings";
import { ApiError, parseBody } from "../../lib/validate";
import { clientFor } from "../../services/account-client";
import { connectFacebook, listPages, selectPage } from "../../services/facebook-setup";
import { DEFAULT_GRAPH, Graph } from "../../services/graph";
import type { AppEnv } from "../../types/app";
import {
  connectSchema,
  disconnectSchema,
  facebookConnectSchema,
  facebookSelectSchema,
  subscribeSchema,
} from "../schemas";

/** Connect, disconnect and subscribe the Instagram account and the Facebook Page. */
export const accountRoutes = new Hono<AppEnv>();

accountRoutes.post("/connect", async (c) => {
  const { token } = await parseBody(c, connectSchema);
  const me = await new Graph(token, c.env.GRAPH_BASE || DEFAULT_GRAPH).me();
  if (!me.ok) throw new ApiError(400, `Instagram rejected the token: ${me.error}`);
  const igId = String(me.data.user_id ?? me.data.id ?? "");
  if (!igId) throw new ApiError(400, "Could not read the account id from the token");
  await saveAccount(c.env, { token, igId, username: me.data.username });
  await logEvent(c.env, {
    kind: "system",
    status: "info",
    platform: "instagram",
    error: `connected @${me.data.username ?? igId}`,
  });
  return c.json({ connected: true, username: me.data.username ?? null, igId });
});

accountRoutes.post("/facebook/connect", async (c) => {
  const { token, pageId } = await parseBody(c, facebookConnectSchema);
  const result = await connectFacebook(c.env, token, pageId);
  if (result.connected) {
    await logEvent(c.env, {
      kind: "system",
      status: "info",
      platform: "facebook",
      error: `connected Facebook Page ${result.page.name}`,
    });
  }
  return c.json(result);
});

accountRoutes.get("/facebook/pages", async (c) => c.json({ pages: await listPages(c.env) }));

accountRoutes.post("/facebook/select", async (c) => {
  const { pageId } = await parseBody(c, facebookSelectSchema);
  const result = await selectPage(c.env, pageId);
  if (result.connected) {
    await logEvent(c.env, {
      kind: "system",
      status: "info",
      platform: "facebook",
      error: `connected Facebook Page ${result.page.name}`,
    });
  }
  return c.json(result);
});

accountRoutes.post("/disconnect", async (c) => {
  const { platform } = await parseBody(c, disconnectSchema);
  await (platform === "facebook" ? clearPage(c.env) : clearAccount(c.env));
  await setSetting(c.env, `subscribed_${platform}`, null);
  return c.json({ connected: false, platform });
});

accountRoutes.post("/subscribe", async (c) => {
  const { platform } = await parseBody(c, subscribeSchema);
  const account = await getAccount(c.env, platform);
  if (!account) throw new ApiError(400, `Connect the ${platform} account first`);
  const result = await clientFor(c.env, account).subscribe();
  if (!result.ok) throw new ApiError(502, result.error);
  await setSetting(c.env, `subscribed_${platform}`, String(Date.now()));
  return c.json({ subscribed: true, platform });
});
