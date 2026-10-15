// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Admin dashboard API (/api/*) and the Instagram OAuth hand-off. Everything except /api/login needs the session cookie.
import { makeToken, readToken, safeEqual } from "./crypto";
import { advance, DEFAULT_FLOW, DEFAULT_PUBLIC_REPLIES, pickReply, start, timeoutFallback, type ConvState } from "./flow";
import { DEFAULT_GRAPH, DEFAULT_OAUTH, Graph } from "./graph";
import { pickRule } from "./match";
import { hourlyLimit, sentLastHour } from "./queue";
import { cleanRule, clearAccount, deleteRule, getAccount, getRule, getSetting, graphFor, isEnabled, listRules, logEvent, now, recentEvents, saveAccount, saveRule, setSetting } from "./store";
import type { Env } from "./types";

const COOKIE = "opendm_session";
const SESSION_TTL = 7 * 86_400;

export const json = (data: unknown, status = 200, headers: HeadersInit = {}) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...headers } });

function cookieOf(req: Request, name: string): string | undefined {
  return req.headers.get("Cookie")?.split(/;\s*/).map((c) => c.split("=")).find(([k]) => k === name)?.[1];
}

export async function isAuthed(env: Env, req: Request): Promise<boolean> {
  return (await readToken(env.SESSION_SECRET, cookieOf(req, COOKIE))) === "admin";
}

const setCookie = (value: string, maxAge: number, url: URL) => `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${url.protocol === "https:" ? "; Secure" : ""}`;

async function body(req: Request): Promise<Record<string, any>> {
  if (!(req.headers.get("Content-Type") ?? "").includes("application/json")) return {};
  return (await req.json().catch(() => ({}))) as Record<string, any>;
}

async function login(env: Env, req: Request, url: URL): Promise<Response> {
  const ip = req.headers.get("CF-Connecting-IP") ?? "local";
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind = 'auth' AND status = 'error' AND ig_user = ? AND ts > ?").bind(ip, now() - 15 * 60_000).first<{ n: number }>();
  if ((recent?.n ?? 0) >= 10) return json({ error: "Too many attempts, try again in 15 minutes" }, 429);
  const { password } = await body(req);
  if (typeof password !== "string" || !env.ADMIN_PASSWORD || !(await safeEqual(password, env.ADMIN_PASSWORD))) {
    await logEvent(env, { kind: "auth", status: "error", ig_user: ip, error: "bad password" });
    return json({ error: "Wrong password" }, 401);
  }
  return json({ ok: true }, 200, { "Set-Cookie": setCookie(await makeToken(env.SESSION_SECRET, "admin", SESSION_TTL), SESSION_TTL, url) });
}

/** Re-run the real flow on a made-up conversation and return the transcript. Nothing is sent or stored. */
async function dryRun(env: Env, b: Record<string, any>) {
  const comment = String(b.comment ?? "");
  const rules = await listRules(env);
  const hit = pickRule(rules, comment, b.mediaId ? String(b.mediaId) : undefined);
  if (!hit) return { matched: false, transcript: [{ from: "system", text: comment ? "No enabled rule matches this comment, so nothing would be sent." : "Type a comment first." }] };
  const { rule, match } = hit;
  const acct = await getAccount(env);
  const vars = { name: String(b.name ?? "").trim() || undefined, username: "sample_user", keyword: match.keyword, link: rule.link, account: acct?.username ?? "youraccount" };
  const following = b.following === "yes" ? true : b.following === "no" ? false : null;
  const transcript: { from: string; text: string; note?: string }[] = [{ from: "user", text: comment, note: match.fuzzy ? `typo match (${match.fuzzy})` : `matched "${match.keyword}" in rule "${rule.name}"` }];
  const s0 = start(rule.flow, vars);
  const pub = pickReply(rule.public_replies.length ? rule.public_replies : DEFAULT_PUBLIC_REPLIES, null, () => 0);
  if (pub) transcript.push({ from: "public", text: pub, note: "public comment reply" });
  s0.messages.forEach((t) => transcript.push({ from: "bot", text: t, note: s0.note }));
  let state: ConvState = s0.state;
  const replies: string[] = (Array.isArray(b.replies) ? b.replies : String(b.replies ?? "").split("\n")).map((x: unknown) => String(x).trim()).filter(Boolean);
  let clock = now();
  for (const reply of replies.slice(0, 12)) {
    transcript.push({ from: "user", text: reply });
    const o = await advance(state, reply, rule.flow, vars, { checkFollow: async () => following, now: clock });
    o.messages.forEach((t) => transcript.push({ from: "bot", text: t, note: o.note }));
    if (!o.messages.length) transcript.push({ from: "system", text: o.note });
    state = o.state;
  }
  if (b.waitMinutes) {
    clock += Number(b.waitMinutes) * 60_000;
    const o = timeoutFallback(state, rule.flow, vars, clock);
    transcript.push({ from: "system", text: o ? `${b.waitMinutes} minutes pass with no reply...` : `${b.waitMinutes} minutes pass: nothing due yet` });
    o?.messages.forEach((t) => transcript.push({ from: "bot", text: t, note: o.note }));
    if (o) state = o.state;
  }
  return { matched: true, rule: { id: rule.id, name: rule.name }, finalStep: state.step, transcript };
}

async function status(env: Env, url: URL) {
  const acct = await getAccount(env);
  const [rules, events24, convs] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) AS n FROM rules").first<{ n: number }>(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM events WHERE kind IN ('comment','dm') AND status = 'sent' AND ts > ?").bind(now() - 86_400_000).first<{ n: number }>(),
    env.DB.prepare("SELECT step, COUNT(*) AS n FROM conversations GROUP BY step").all<{ step: string; n: number }>(),
  ]);
  return {
    enabled: await isEnabled(env),
    connected: !!acct,
    username: acct?.username ?? null,
    igId: acct?.igId ?? null,
    tokenError: await getSetting(env, "token_error"),
    tokenExpires: Number((await getSetting(env, "token_expires")) ?? 0) || null,
    webhookUrl: `${url.origin}/webhook`,
    verifyTokenSet: !!env.VERIFY_TOKEN,
    oauthAvailable: !!env.INSTAGRAM_APP_ID,
    rules: rules?.n ?? 0,
    sent24h: events24?.n ?? 0,
    sentLastHour: await sentLastHour(env),
    hourlyLimit: await hourlyLimit(env),
    conversations: Object.fromEntries(convs.results.map((r) => [r.step, r.n])),
    defaults: { flow: DEFAULT_FLOW, publicReplies: DEFAULT_PUBLIC_REPLIES },
  };
}

export async function handleApi(env: Env, req: Request, url: URL): Promise<Response> {
  const path = url.pathname;
  const method = req.method;
  if (path === "/api/login" && method === "POST") return login(env, req, url);
  if (path === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": setCookie("", 0, url) });
  if (!(await isAuthed(env, req))) return json({ error: "Not logged in" }, 401);
  if (method !== "GET" && !(req.headers.get("Content-Type") ?? "").includes("application/json")) return json({ error: "JSON body required" }, 415);

  if (path === "/api/status" && method === "GET") return json(await status(env, url));
  if (path === "/api/enabled" && method === "POST") {
    await setSetting(env, "enabled", (await body(req)).enabled ? "1" : "0");
    return json({ enabled: await isEnabled(env) });
  }
  if (path === "/api/settings" && method === "POST") {
    const n = Number((await body(req)).hourlyLimit);
    if (!Number.isInteger(n) || n < 1 || n > 5000) return json({ error: "Hourly limit must be 1 to 5000" }, 400);
    await setSetting(env, "hourly_limit", String(n));
    return json({ hourlyLimit: n });
  }

  if (path === "/api/connect" && method === "POST") {
    const token = String((await body(req)).token ?? "").trim();
    if (token.length < 20) return json({ error: "Paste the Instagram access token" }, 400);
    const me = await new Graph(token, env.GRAPH_BASE || DEFAULT_GRAPH).me();
    if (!me.ok) return json({ error: `Instagram rejected the token: ${me.error}` }, 400);
    const igId = String(me.data.user_id ?? me.data.id ?? "");
    if (!igId) return json({ error: "Could not read the account id from the token" }, 400);
    await saveAccount(env, { token, igId, username: me.data.username });
    await logEvent(env, { kind: "system", status: "info", error: `connected @${me.data.username ?? igId}` });
    return json({ connected: true, username: me.data.username ?? null, igId });
  }
  if (path === "/api/disconnect" && method === "POST") {
    await clearAccount(env);
    return json({ connected: false });
  }
  if (path === "/api/subscribe" && method === "POST") {
    const acct = await getAccount(env);
    if (!acct) return json({ error: "Connect an account first" }, 400);
    const r = await graphFor(env, acct).subscribe(acct.igId);
    return r.ok ? json({ subscribed: true }) : json({ error: r.error }, 502);
  }

  if (path === "/api/rules" && method === "GET") return json({ rules: await listRules(env) });
  if (path === "/api/rules" && method === "POST") {
    const c = cleanRule(await body(req));
    if (!c.ok) return json({ error: c.error }, 400);
    const id = await saveRule(env, null, c.row);
    return json({ rule: await getRule(env, id) }, 201);
  }
  const m = path.match(/^\/api\/rules\/(\d+)$/);
  if (m) {
    const id = Number(m[1]);
    if (!(await getRule(env, id))) return json({ error: "Rule not found" }, 404);
    if (method === "PUT") {
      const c = cleanRule(await body(req));
      if (!c.ok) return json({ error: c.error }, 400);
      await saveRule(env, id, c.row);
      return json({ rule: await getRule(env, id) });
    }
    if (method === "DELETE") {
      await deleteRule(env, id);
      return json({ deleted: id });
    }
  }

  if (path === "/api/test" && method === "POST") return json(await dryRun(env, await body(req)));
  if (path === "/api/log" && method === "GET") {
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit")) || 50));
    return json({ events: await recentEvents(env, limit, url.searchParams.get("kind") || undefined) });
  }
  return json({ error: "Not found" }, 404);
}

// ---- OAuth with Instagram Login ---------------------------------------------------------------------------------
const SCOPES = "instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments";

export async function handleOAuth(env: Env, req: Request, url: URL): Promise<Response> {
  if (!(await isAuthed(env, req))) return Response.redirect(`${url.origin}/admin`, 302);
  const redirectUri = `${url.origin}/admin/oauth/callback`;
  if (url.pathname.endsWith("/start")) {
    if (!env.INSTAGRAM_APP_ID) return json({ error: "Set INSTAGRAM_APP_ID to use OAuth" }, 400);
    const state = await makeToken(env.SESSION_SECRET, "oauth", 600);
    const q = new URLSearchParams({ client_id: env.INSTAGRAM_APP_ID, redirect_uri: redirectUri, response_type: "code", scope: SCOPES, state });
    return Response.redirect(`https://www.instagram.com/oauth/authorize?${q}`, 302);
  }
  const back = (msg: string) => Response.redirect(`${url.origin}/admin#${encodeURIComponent(msg)}`, 302);
  if ((await readToken(env.SESSION_SECRET, url.searchParams.get("state"))) !== "oauth") return back("OAuth state invalid or expired, try again");
  const code = (url.searchParams.get("code") ?? "").replace(/#_$/, "");
  if (!code) return back(`Instagram said: ${url.searchParams.get("error_description") ?? "no code"}`);
  const short = await Graph.exchangeCode(env.OAUTH_BASE || DEFAULT_OAUTH, { clientId: env.INSTAGRAM_APP_ID ?? "", clientSecret: env.INSTAGRAM_APP_SECRET, redirectUri, code });
  if (!short.ok) return back(`Code exchange failed: ${short.error}`);
  const long = await Graph.longLived(env.GRAPH_BASE || DEFAULT_GRAPH, short.data.access_token, env.INSTAGRAM_APP_SECRET);
  const token = long.ok ? long.data.access_token : short.data.access_token;
  const me = await new Graph(token, env.GRAPH_BASE || DEFAULT_GRAPH).me();
  if (!me.ok) return back(`Could not read the account: ${me.error}`);
  await saveAccount(env, { token, igId: String(me.data.user_id ?? me.data.id ?? short.data.user_id), username: me.data.username, expiresInSec: long.ok ? long.data.expires_in : 3600 });
  return back(`Connected @${me.data.username ?? ""}`);
}
