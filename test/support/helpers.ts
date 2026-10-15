// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { vi } from "vitest";
import { saveAccount, savePage } from "../../src/db/accounts";
import { createRule } from "../../src/db/rules";
import { ensureSchema, resetSchemaCache } from "../../src/db/schema";
import worker from "../../src/index";
import { sign } from "../../src/lib/crypto";
import { OpenDmClient } from "../../src/mcp/client.ts";
import { ruleSchema } from "../../src/routes/schemas";
import type { Env } from "../../src/types/env";

export const testEnv = env as unknown as Env;
export const IG_ID = "17841400000000001";
export const TOKEN = "IGAAtesttoken000000000000000000000000";

export async function resetDb() {
  resetSchemaCache();
  await ensureSchema(testEnv.DB);
  for (const t of ["settings", "rules", "conversations", "events", "processed", "sends", "outbox", "variant_counters"])
    await testEnv.DB.exec(`DELETE FROM ${t}`);
}

export const connect = () => saveAccount(testEnv, { token: TOKEN, igId: IG_ID, username: "shop_account" });

export async function request(path: string, init: RequestInit = {}) {
  const ctx = createExecutionContext();
  const res = await worker.fetch(new Request(`https://opendm.test${path}`, init), testEnv, ctx);
  await waitOnExecutionContext(ctx);
  return res;
}

export async function postWebhook(payload: unknown, opts: { secret?: string; signature?: string | null } = {}) {
  const body = JSON.stringify(payload);
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const sig =
    opts.signature === undefined ? await sign(opts.secret ?? testEnv.INSTAGRAM_APP_SECRET ?? "", body) : opts.signature;
  if (sig) headers["X-Hub-Signature-256"] = sig;
  return request("/webhook", { method: "POST", headers, body });
}

export async function login(password = testEnv.ADMIN_PASSWORD) {
  const res = await request("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password }),
  });
  return { res, cookie: (res.headers.get("Set-Cookie") ?? "").split(";")[0] };
}

export async function api(cookie: string, method: string, path: string, body?: unknown) {
  const res = await request(path, {
    method,
    headers: { Cookie: cookie, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { res, data: (await res.json().catch(() => ({}))) as any };
}

// ---- a fake Instagram Graph API -----------------------------------------------------------------------------------
export interface GraphCall {
  method: string;
  url: URL;
  body: any;
  auth: string | null;
}

export interface GraphMock {
  calls: GraphCall[];
  /** Per-path overrides: return a Response (or JSON body) for a matching call. */
  on(match: RegExp, handler: (c: GraphCall) => Response | object | undefined): void;
  sent(): { kind: string; to: string; text: string }[];
}

/** Records every outgoing fetch and answers like graph.instagram.com. */
export function mockGraph(opts: { following?: boolean | null; name?: string } = {}): GraphMock {
  const calls: GraphCall[] = [];
  const handlers: [RegExp, (c: GraphCall) => Response | object | undefined][] = [];
  let n = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init);
    const url = new URL(req.url);
    const text = new TextDecoder().decode(await req.arrayBuffer());
    const call: GraphCall = {
      method: req.method,
      url,
      body: text?.startsWith("{") ? JSON.parse(text) : text,
      auth: req.headers.get("Authorization"),
    };
    calls.push(call);
    for (const [re, h] of handlers) {
      if (re.test(url.pathname + url.search)) {
        const r = h(call);
        if (r instanceof Response) return r;
        if (r) return Response.json(r);
      }
    }
    if (url.pathname.endsWith("/messages")) return Response.json({ recipient_id: "x", message_id: `mid.${++n}` });
    if (url.pathname.endsWith("/replies")) return Response.json({ id: `reply.${++n}` });
    if (url.pathname.endsWith("/me"))
      return Response.json({ user_id: IG_ID, username: "shop_account", account_type: "BUSINESS" });
    if (url.pathname.endsWith("/refresh_access_token"))
      return Response.json({
        access_token: "IGAArefreshed0000000000000000000000",
        token_type: "bearer",
        expires_in: 5184000,
      });
    if (url.pathname.endsWith("/subscribed_apps")) {
      return call.method === "GET"
        ? Response.json({ data: [{ subscribed_fields: ["comments", "messages"] }] })
        : Response.json({ success: true });
    }
    if (/\/\d+$/.test(url.pathname) && url.searchParams.get("fields")?.includes("first_name")) {
      return Response.json({ first_name: opts.name?.split(" ")[0] ?? "Sam", name: opts.name ?? "Sam Rivera" });
    }
    if (/\/\d+$/.test(url.pathname) && url.searchParams.get("fields")?.includes("is_user_follow_business")) {
      return Response.json({
        name: opts.name ?? "Sam Rivera",
        username: "sam",
        ...(typeof opts.following === "boolean" ? { is_user_follow_business: opts.following } : {}),
      });
    }
    if (call.method === "GET" && /\/\d+$/.test(url.pathname))
      return Response.json({ id: url.pathname.split("/").at(-1), name: "Acme Studio", username: "acme_ig" });
    return Response.json({ error: { message: `unmocked ${url.pathname}`, code: 100 } }, { status: 400 });
  });
  const mock: GraphMock = {
    calls,
    on: (match, handler) => void handlers.push([match, handler]),
    sent: () =>
      calls
        .filter((c) => c.method === "POST" && /\/(messages|replies|comments)$/.test(c.url.pathname))
        .map((c) =>
          /\/(replies|comments)$/.test(c.url.pathname)
            ? { kind: "public_reply", to: c.url.pathname.split("/").at(-2)!, text: c.body.message }
            : {
                kind: c.body.recipient.comment_id ? "private_reply" : "dm",
                to: c.body.recipient.comment_id ?? c.body.recipient.id,
                text: c.body.message.text,
              },
        ),
  };
  return mock;
}

// ---- realistic webhook payloads (shapes from Meta's Instagram webhook docs) ---------------------------------------
export const commentEvent = (o: {
  id?: string;
  text: string;
  from?: string;
  username?: string;
  media?: string;
  parent?: string;
  time?: number;
}) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ID,
      time: o.time ?? 1_760_000_000,
      changes: [
        {
          field: "comments",
          value: {
            from: { id: o.from ?? "17841499999999991", username: o.username ?? "sam" },
            media: { id: o.media ?? "18000000000000001", media_product_type: "FEED" },
            id: o.id ?? "18100000000000001",
            text: o.text,
            ...(o.parent ? { parent_id: o.parent } : {}),
          },
        },
      ],
    },
  ],
});

export const dmEvent = (o: { from?: string; text: string; mid?: string; echo?: boolean }) => ({
  object: "instagram",
  entry: [
    {
      id: IG_ID,
      time: 1_760_000_100,
      messaging: [
        {
          sender: { id: o.echo ? IG_ID : (o.from ?? "17841499999999991") },
          recipient: { id: o.echo ? (o.from ?? "17841499999999991") : IG_ID },
          timestamp: 1_760_000_100_000,
          message: {
            mid: o.mid ?? `m_${Math.random().toString(36).slice(2)}`,
            text: o.text,
            ...(o.echo ? { is_echo: true } : {}),
          },
        },
      ],
    },
  ],
});

export async function addRule(overrides: Record<string, unknown> = {}) {
  const values = ruleSchema.parse({
    name: "Guide",
    keywords: ["GUIDE"],
    link: "https://example.com/guide",
    public_replies: ["Sent you a DM!"],
    flow: {},
    ...overrides,
  });
  return createRule(testEnv, values);
}

/** An OpenDM API client wired straight into the Worker, authenticated like the CLI/MCP server (bearer token). */
export function workerClient(token: string = testEnv.ADMIN_PASSWORD) {
  const viaWorker: typeof fetch = (input, init) => {
    const url = new URL(String(input));
    return request(url.pathname + url.search, init);
  };
  return new OpenDmClient("https://opendm.test", token, viaWorker);
}

// ---- Facebook ---------------------------------------------------------------------------------------------------
export const PAGE_ID = "112233445566";
export const PAGE_TOKEN = "EAAFpagetoken000000000000000000000000";

/** Connects a Facebook Page (optionally with a linked Instagram account for Facebook Login). */
export const connectPage = (o: { igId?: string; igUsername?: string } = {}) =>
  savePage(testEnv, {
    token: PAGE_TOKEN,
    pageId: PAGE_ID,
    name: "Acme Studio",
    igId: o.igId ?? null,
    igUsername: o.igUsername ?? null,
  });

/** A Page feed webhook for a new comment (a top-level comment has parent_id = post_id). */
export const fbCommentEvent = (o: {
  id?: string;
  text?: string;
  from?: string | null;
  name?: string;
  post?: string;
  parent?: string;
  verb?: string;
}) => ({
  object: "page",
  entry: [
    {
      id: PAGE_ID,
      time: 1_760_000_000,
      changes: [
        {
          field: "feed",
          value: {
            item: "comment",
            verb: o.verb ?? "add",
            comment_id: o.id ?? "112233445566_998877",
            post_id: o.post ?? "112233445566_555444",
            parent_id: o.parent ?? o.post ?? "112233445566_555444",
            message: o.text ?? "GUIDE",
            ...(o.from === null ? {} : { from: { id: o.from ?? "5500110022", name: o.name ?? "Sam Rivera" } }),
          },
        },
      ],
    },
  ],
});

/** A Messenger message to the Page. */
export const fbMessageEvent = (o: { from?: string; text: string; mid?: string; echo?: boolean }) => ({
  object: "page",
  entry: [
    {
      id: PAGE_ID,
      time: 1_760_000_100,
      messaging: [
        {
          sender: { id: o.echo ? PAGE_ID : (o.from ?? "5500110022") },
          recipient: { id: o.echo ? (o.from ?? "5500110022") : PAGE_ID },
          timestamp: 1_760_000_100_000,
          message: {
            mid: o.mid ?? `m_fb_${Math.random().toString(36).slice(2)}`,
            text: o.text,
            ...(o.echo ? { is_echo: true } : {}),
          },
        },
      ],
    },
  ],
});
