// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The DM conversation as a state machine: opener -> follow gate -> email capture -> link.
// No I/O in here: the caller supplies the follow check and the clock, so the same code drives live DMs and the dashboard dry run.
import { words } from "./matching";

export type AskEmail = "off" | "optional" | "required";
export type Step = "opened" | "awaiting_follow" | "awaiting_email" | "done" | "stopped";

export interface Flow {
  /** Private reply is a short "want it?" and the link follows once they answer. Off: the link goes out in the private reply. */
  opener: boolean;
  openerText: string;
  requireFollow: boolean;
  followText: string;
  followRetryText: string;
  /** "Not following yet" answers tolerated before giving up. */
  followMaxTries: number;
  /** After the tries: send the link anyway, or stop politely. */
  followGiveUp: "send" | "stop";
  followStopText: string;
  /** Follow question unanswered this long: the cron sends the link anyway. */
  followTimeoutMin: number;
  followTimeoutText: string;
  askEmail: AskEmail;
  emailText: string;
  emailRetryText: string;
  emailThanks: string;
  emailStopText: string;
  deliverText: string;
}

export const DEFAULT_FLOW: Flow = {
  opener: true,
  openerText: "Hey {name}! Saw your comment. Want the link? Just reply yes and I'll send it right here.",
  requireFollow: true,
  followText:
    'One favor first: follow @{account} here https://www.instagram.com/{account}\n\nThen reply "done" and I\'ll send it right over.',
  followRetryText: 'Hmm, I can\'t see the follow yet. Follow @{account}, then reply "done".',
  followMaxTries: 2,
  followGiveUp: "send",
  followStopText: "No problem. Come back any time!",
  followTimeoutMin: 20,
  followTimeoutText: "No worries if not, here's the link anyway:\n{link}",
  askEmail: "off",
  emailText: "Last thing: what's your email? I'll send updates now and then (or say \"no\" to skip).",
  emailRetryText: 'That doesn\'t look like an email address. Try again, or say "no" to skip.',
  emailThanks: "Got it, thanks!",
  emailStopText: "No problem. Come back any time!",
  deliverText: "Here you go:\n{link}\nIf you get stuck, just reply here.",
};

const MAX_TEXT = 900;
const numberIn = (v: unknown, def: number, lo: number, hi: number) =>
  Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def;

/** Only known keys with the right types; empty text falls back to the default. */
export function resolveFlow(raw: unknown): Flow {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_FLOW };
  for (const [k, def] of Object.entries(DEFAULT_FLOW)) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (typeof def === "boolean") out[k] = v === true || v === "true" || v === 1;
    else if (k === "followMaxTries") out[k] = numberIn(v, def as number, 1, 5);
    else if (k === "followTimeoutMin") out[k] = numberIn(v, def as number, 2, 600);
    else if (k === "askEmail") out[k] = ["off", "optional", "required"].includes(String(v)) ? v : def;
    else if (k === "followGiveUp") out[k] = ["send", "stop"].includes(String(v)) ? v : def;
    else if (String(v).trim()) out[k] = String(v).trim().slice(0, MAX_TEXT);
  }
  return out as unknown as Flow;
}

export interface Vars {
  name?: string;
  username?: string;
  keyword: string;
  link: string;
  account?: string;
}

/** Placeholders. {name} disappears cleanly when unknown ("Hey {name}!" -> "Hey!"). Unknown placeholders stay as typed. */
export function fill(text: string, vars: Partial<Vars>): string {
  const v: Record<string, string | undefined> = { ...vars, name: vars.name || vars.username };
  return text.replace(/ ?\{name\}/g, v.name ? ` ${v.name}` : "").replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
}

export interface ConvState {
  step: Step;
  tries: number;
  email: string | null;
  followAskedAt: number | null;
}

export interface Deps {
  /** true/false from the Graph API; null when it cannot tell (the follow check is limited by Meta). */
  checkFollow: () => Promise<boolean | null>;
  now: number;
}

export interface Outcome {
  state: ConvState;
  /** Direct messages to send, in order. */
  messages: string[];
  /** One line for the event log. */
  note: string;
}

const NO = new Set(["no", "nah", "nope", "skip", "later", "n", "na", "never", "pass", "dont", "nahi", "non", "nein"]);
const YES = new Set([
  "yes",
  "yess",
  "yeah",
  "yea",
  "yep",
  "yup",
  "ya",
  "y",
  "sure",
  "ok",
  "okay",
  "pls",
  "please",
  "plz",
  "send",
  "go",
  "done",
  "ready",
  "want",
  "followed",
  "following",
  "haan",
]);

/** A "no thanks": a short message with a no-word in it, or a thumbs-down. */
export function isNo(text: string): boolean {
  const w = words(text);
  return (
    (w.length <= 5 && w.some((x) => NO.has(x))) ||
    /not now|no thanks|not interested|maybe later|don'?t/i.test(text) ||
    /👎|🙅/u.test(text)
  );
}

export function isYes(text: string): boolean {
  return words(text).some((x) => YES.has(x)) || /👍|✅|🙌|🙏|❤️|🔥/u.test(text);
}

/** The first email-looking thing in a message ("sure, it's Jo.Doe@Mail.com!" -> "jo.doe@mail.com"). */
export function extractEmail(text: string): string | null {
  const m = text.match(/[A-Z0-9._%+-]+@[A-Z0-9-]+(?:\.[A-Z0-9-]+)*\.[A-Z]{2,}/i);
  const e = m?.[0].toLowerCase().replace(/\.+$/, "");
  return e && e.length <= 254 && !e.includes("..") ? e : null;
}

const needsOpener = (f: Flow) => f.opener || f.requireFollow || f.askEmail !== "off";

const out = (
  state: Partial<ConvState> & { step: Step },
  base: ConvState,
  messages: string[],
  note: string,
): Outcome => ({ state: { ...base, ...state }, messages, note });

/** A comment matched: the private reply. With gates configured the opener always comes first (their tap opens the 24h window). */
export function start(flow: Flow, vars: Vars): Outcome {
  const base: ConvState = { step: "opened", tries: 0, email: null, followAskedAt: null };
  if (needsOpener(flow)) return out({ step: "opened" }, base, [fill(flow.openerText, vars)], "opener sent");
  return out({ step: "done" }, base, [fill(flow.deliverText, vars)], "link sent in the private reply");
}

const deliver = (flow: Flow, vars: Vars, base: ConvState, note: string, pre: string[] = []) =>
  out({ step: "done" }, base, [...pre, fill(flow.deliverText, vars)], note);

/** Past the follow gate: ask for the email, or deliver. */
function afterFollow(flow: Flow, vars: Vars, s: ConvState, note: string): Outcome {
  if (flow.askEmail !== "off")
    return out({ step: "awaiting_email", tries: 0 }, s, [fill(flow.emailText, vars)], `${note}; email asked`);
  return deliver(flow, vars, s, `${note}; link sent`);
}

function askFollow(flow: Flow, vars: Vars, s: ConvState, deps: Deps): Outcome {
  return out(
    { step: "awaiting_follow", tries: 0, followAskedAt: deps.now },
    s,
    [fill(flow.followText, vars)],
    "follow asked",
  );
}

/** The user wrote in: move the conversation one step. */
export async function advance(state: ConvState, text: string, flow: Flow, vars: Vars, deps: Deps): Promise<Outcome> {
  switch (state.step) {
    case "opened": {
      if (isNo(text)) return out({ step: "stopped" }, state, [], "declined at the opener");
      if (flow.requireFollow) return askFollow(flow, vars, state, deps);
      return afterFollow(flow, vars, state, "opener answered");
    }
    case "awaiting_follow": {
      const following = await deps.checkFollow();
      if (following === true) return afterFollow(flow, vars, state, "follow verified");
      // Unknown (the API can't tell): take their word when they say they followed.
      if (following === null && isYes(text) && !isNo(text))
        return afterFollow(flow, vars, state, "follow unverified, user said done");
      const tries = state.tries + 1;
      if (tries >= flow.followMaxTries) {
        if (flow.followGiveUp === "send")
          return deliver(flow, vars, { ...state, tries }, "follow gate given up, link sent anyway");
        return out(
          { step: "stopped", tries },
          state,
          flow.followStopText ? [fill(flow.followStopText, vars)] : [],
          "follow gate given up, stopped",
        );
      }
      return out(
        { step: "awaiting_follow", tries },
        state,
        [fill(flow.followRetryText, vars)],
        `not following yet (${tries}/${flow.followMaxTries})`,
      );
    }
    case "awaiting_email": {
      const email = extractEmail(text);
      if (email)
        return deliver(
          flow,
          vars,
          { ...state, email },
          "email captured, link sent",
          flow.emailThanks ? [fill(flow.emailThanks, vars)] : [],
        );
      if (flow.askEmail === "optional" || (isNo(text) && flow.askEmail !== "required"))
        return deliver(flow, vars, state, "email skipped, link sent");
      const tries = state.tries + 1;
      if (tries >= 3)
        return out(
          { step: "stopped", tries },
          state,
          flow.emailStopText ? [fill(flow.emailStopText, vars)] : [],
          "email required, not given, stopped",
        );
      return out({ step: "awaiting_email", tries }, state, [fill(flow.emailRetryText, vars)], "email asked again");
    }
    default:
      return out({ step: state.step }, state, [], "conversation already finished");
  }
}

/** Follow question left unanswered past the timeout: send the link anyway (no email ask). Null when not due. */
export function timeoutFallback(state: ConvState, flow: Flow, vars: Vars, now: number): Outcome | null {
  if (state.step !== "awaiting_follow" || state.followAskedAt == null) return null;
  if (now - state.followAskedAt < flow.followTimeoutMin * 60_000) return null;
  return out({ step: "done" }, state, [fill(flow.followTimeoutText, vars)], "follow timed out, link sent anyway");
}

/** Pick a public reply, rotating so the same line doesn't repeat back to back. */
export function pickReply(list: string[], last?: string | null, rnd: () => number = Math.random): string | null {
  const all = list.filter((x) => x.trim());
  const pool = all.filter((x) => x !== last);
  const from = pool.length ? pool : all;
  return from.length ? from[Math.floor(rnd() * from.length)] : null;
}

export const DEFAULT_PUBLIC_REPLIES = [
  "Sent you a DM! Check your message requests if you don't see it.",
  "Just DM'd you! It may be in your message requests.",
  "Done, check your DMs!",
];
