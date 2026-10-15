// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { logEvent } from "../db/events";
import { safeEqual, verifySignature } from "../lib/crypto";
import { handleWebhook } from "../services/webhook-processor";
import type { AppEnv } from "../types/app";
import type { WebhookPayload } from "../types/instagram";

export const webhookRoutes = new Hono<AppEnv>();

/** Meta calls this once when the webhook is saved in the app dashboard. */
webhookRoutes.get("/", async (c) => {
  const q = c.req.query();
  const valid = q["hub.mode"] === "subscribe" && !!c.env.VERIFY_TOKEN && (await safeEqual(q["hub.verify_token"] ?? "", c.env.VERIFY_TOKEN));
  return valid ? c.text(q["hub.challenge"] ?? "") : c.text("Forbidden", 403);
});

webhookRoutes.post("/", async (c) => {
  const raw = new Uint8Array(await c.req.arrayBuffer());
  if (!(await verifySignature(c.env.INSTAGRAM_APP_SECRET, raw, c.req.header("X-Hub-Signature-256") ?? null))) {
    return c.text("Bad signature", 401);
  }
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return c.text("Bad JSON", 400);
  }
  // Answer Meta right away (it retries slow endpoints) and do the work afterwards.
  c.executionCtx.waitUntil(
    handleWebhook(c.env, payload).catch((e: Error) => logEvent(c.env, { kind: "system", status: "error", error: `webhook handler: ${e.message}` })),
  );
  return c.text("EVENT_RECEIVED");
});
