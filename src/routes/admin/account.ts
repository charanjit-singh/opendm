// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { clearAccount, getAccount, saveAccount } from "../../db/account";
import { logEvent } from "../../db/events";
import { ApiError, parseBody } from "../../lib/validate";
import { DEFAULT_GRAPH, Graph, graphClientFor } from "../../services/graph";
import type { AppEnv } from "../../types/app";
import { connectSchema } from "../schemas";

/** Connect, disconnect and subscribe the Instagram account. */
export const accountRoutes = new Hono<AppEnv>();

accountRoutes.post("/connect", async (c) => {
  const { token } = await parseBody(c, connectSchema);
  const me = await new Graph(token, c.env.GRAPH_BASE || DEFAULT_GRAPH).me();
  if (!me.ok) throw new ApiError(400, `Instagram rejected the token: ${me.error}`);
  const igId = String(me.data.user_id ?? me.data.id ?? "");
  if (!igId) throw new ApiError(400, "Could not read the account id from the token");
  await saveAccount(c.env, { token, igId, username: me.data.username });
  await logEvent(c.env, { kind: "system", status: "info", error: `connected @${me.data.username ?? igId}` });
  return c.json({ connected: true, username: me.data.username ?? null, igId });
});

accountRoutes.post("/disconnect", async (c) => {
  await clearAccount(c.env);
  return c.json({ connected: false });
});

accountRoutes.post("/subscribe", async (c) => {
  const account = await getAccount(c.env);
  if (!account) throw new ApiError(400, "Connect an account first");
  const result = await graphClientFor(c.env, account).subscribe(account.igId);
  if (!result.ok) throw new ApiError(502, result.error);
  return c.json({ subscribed: true });
});
