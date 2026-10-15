// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// OpenDM: Instagram comment-to-DM automation on Cloudflare Workers. Source: https://github.com/charanjit-singh/opendm
import { handleApi, handleOAuth, json } from "./admin";
import { safeEqual, verifySignature } from "./crypto";
import { handleWebhook, type WebhookPayload } from "./engine";
import { runCron } from "./maintenance";
import { ensureSchema } from "./schema";
import { adminPage, privacyPage } from "./ui";
import { logEvent } from "./store";
import type { Env } from "./types";

const VERSION = "0.1.0";
const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" } });

/** Meta calls this once when you save the webhook in the app dashboard. */
async function verifyWebhook(env: Env, url: URL): Promise<Response> {
  const ok = url.searchParams.get("hub.mode") === "subscribe" && !!env.VERIFY_TOKEN && (await safeEqual(url.searchParams.get("hub.verify_token") ?? "", env.VERIFY_TOKEN));
  return ok ? new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200 }) : new Response("Forbidden", { status: 403 });
}

async function receiveWebhook(env: Env, req: Request, ctx: ExecutionContext): Promise<Response> {
  const raw = new Uint8Array(await req.arrayBuffer());
  if (!(await verifySignature(env.INSTAGRAM_APP_SECRET, raw, req.headers.get("X-Hub-Signature-256")))) return new Response("Bad signature", { status: 401 });
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }
  // Answer Meta right away (it retries slow endpoints), do the work after.
  ctx.waitUntil(
    handleWebhook(env, payload).catch((e) => logEvent(env, { kind: "system", status: "error", error: `webhook handler: ${(e as Error).message}` })),
  );
  return new Response("EVENT_RECEIVED", { status: 200 });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname: path } = url;
    if (path === "/health") return json({ ok: true, name: "opendm", version: VERSION });
    if (path === "/favicon.ico") return new Response(null, { status: 204 });
    if (path === "/privacy") return html(privacyPage());
    if (path === "/") return Response.redirect(`${url.origin}/admin`, 302);
    try {
      await ensureSchema(env.DB);
      if (path === "/webhook") {
        if (req.method === "GET") return await verifyWebhook(env, url);
        if (req.method === "POST") return await receiveWebhook(env, req, ctx);
        return new Response("Method not allowed", { status: 405 });
      }
      if (path === "/admin") return html(adminPage());
      if (path.startsWith("/admin/oauth/")) return await handleOAuth(env, req, url);
      if (path.startsWith("/api/")) return await handleApi(env, req, url);
    } catch (e) {
      return json({ error: `Server error: ${(e as Error).message}` }, 500);
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureSchema(env.DB).then(() => runCron(env)));
  },
} satisfies ExportedHandler<Env>;
