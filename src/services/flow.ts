// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The DM conversation as a state machine: opener -> follow gate -> email capture -> link.
// No I/O in here: the caller supplies the follow check and the clock, so the same code drives live DMs and the dashboard dry run.
import { words } from "./matching";

export type AskEmail = "off" | "optional" | "required";
export type Rotation = "round_robin" | "random";

/** Every message the flow can send. Each can have several variants (see Flow.variants). */
export const MESSAGE_KEYS = [
  "openerText",
  "followText",
  "followRetryText",
  "followStopText",
  "followTimeoutText",
  "emailText",
  "emailRetryText",
  "emailThanks",
  "emailStopText",
  "deliverText",
] as const;
export type MessageKey = (typeof MESSAGE_KEYS)[number];
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
  /** How variants are picked: take turns, or at random. */
  rotation: Rotation;
  /** Extra wordings per message. When a key is listed here its variants replace the single text above. */
  variants: Partial<Record<MessageKey, string[]>>;
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
  rotation: "round_robin",
  variants: {},
};

/** Facebook cannot check follows, so the default ask is about liking the Page and trusts "done". */
const FACEBOOK_DEFAULTS: Partial<Flow> = {
  followText:
    'One favor first: like our Page {account} on Facebook.\n\nThen reply "done" and I\'ll send it right over.',
  followRetryText: 'Please like {account} on Facebook, then reply "done".',
};

const MAX_VARIANTS = 10;

/** All wordings of a message: its variants if any were set, else the single text. */
export const variantsOf = (flow: Flow, key: MessageKey): string[] =>
  flow.variants[key]?.length ? flow.variants[key] : [flow[key]];

const MAX_TEXT = 900;
const numberIn = (v: unknown, def: number, lo: number, hi: number) =>
  Number.isFinite(Number(v)) && v !== "" && v !== null ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : def;

function cleanVariants(raw: unknown): Flow["variants"] {
  const out: Flow["variants"] = {};
  if (!raw || typeof raw !== "object") return out;
  for (const key of MESSAGE_KEYS) {
    const list = (raw as Record<string, unknown>)[key];
    if (!Array.isArray(list)) continue;
    const clean = list
      .map((text) => String(text).trim().slice(0, MAX_TEXT))
      .filter(Boolean)
      .slice(0, MAX_VARIANTS);
    if (clean.length) out[key] = clean;
  }
  return out;
}

/** Only known keys with the right types; empty text falls back to the default. */
export function resolveFlow(raw: unknown, channel: "instagram" | "facebook" | "both" = "instagram"): Flow {
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const out: Record<string, unknown> = { ...DEFAULT_FLOW, ...(channel === "facebook" ? FACEBOOK_DEFAULTS : {}) };
  for (const [k, def] of Object.entries(DEFAULT_FLOW)) {
    const v = src[k];
    if (v === undefined || v === null) continue;
    if (k === "variants") out[k] = cleanVariants(v);
    else if (k === "rotation") out[k] = v === "random" ? "random" : "round_robin";
    else if (typeof def === "boolean") out[k] = v === true || v === "true" || v === 1;
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

/** Chooses which variant (0-based) of a message to send. `count` is how many there are. */
export type Picker = (key: string, count: number) => number;

/** Always the first wording. The default for tests and previews. */
export const firstVariant: Picker = () => 0;

export interface Deps {
  /** true/false from the Graph API; null when it cannot tell (the follow check is limited by Meta). */
  checkFollow: () => Promise<boolean | null>;
  now: number;
  pick?: Picker;
}

/** Which variant of which message went out, so the log can show it. */
export interface SentVariant {
  key: MessageKey;
  /** 0-based. */
  index: number;
  total: number;
}

export interface Outcome {
  state: ConvState;
  /** Direct messages to send, in order. */
  messages: string[];
  /** Which variant each message used (same length as `messages`). */
  variants: SentVariant[];
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

/** Fills in messages for one step, remembering which variant of each was chosen. */
function speaker(flow: Flow, vars: Vars, pick: Picker = firstVariant) {
  const sent: SentVariant[] = [];
  const say = (key: MessageKey): string => {
    const list = variantsOf(flow, key);
    const index = list.length > 1 ? Math.min(list.length - 1, Math.max(0, pick(key, list.length))) : 0;
    sent.push({ key, index, total: list.length });
    return fill(list[index], vars);
  };
  return { say, sent };
}

type Speaker = ReturnType<typeof speaker>;

const out = (
  state: Partial<ConvState> & { step: Step },
  base: ConvState,
  messages: string[],
  note: string,
  talk?: Speaker,
): Outcome => ({ state: { ...base, ...state }, messages, variants: talk?.sent ?? [], note });

/** A comment matched: the private reply. With gates configured the opener always comes first (their tap opens the 24h window). */
export function start(flow: Flow, vars: Vars, pick?: Picker): Outcome {
  const base: ConvState = { step: "opened", tries: 0, email: null, followAskedAt: null };
  const talk = speaker(flow, vars, pick);
  if (needsOpener(flow)) return out({ step: "opened" }, base, [talk.say("openerText")], "opener sent", talk);
  return out({ step: "done" }, base, [talk.say("deliverText")], "link sent in the private reply", talk);
}

/** A person wrote in without a comment first (a keyword DM): their message already opened the window, so skip the opener. */
export async function startFromDm(flow: Flow, text: string, vars: Vars, deps: Deps): Promise<Outcome> {
  const opened: ConvState = { step: "opened", tries: 0, email: null, followAskedAt: null };
  return advance(opened, needsOpener(flow) ? "yes" : text, flow, vars, deps);
}

function deliver(flow: Flow, vars: Vars, base: ConvState, note: string, talk: Speaker, withThanks = false): Outcome {
  const thanks = withThanks && flow.emailThanks ? [talk.say("emailThanks")] : [];
  return out({ step: "done" }, base, [...thanks, talk.say("deliverText")], note, talk);
}

/** Past the follow gate: ask for the email, or deliver. */
function afterFollow(flow: Flow, vars: Vars, s: ConvState, note: string, pick?: Picker): Outcome {
  const talk = speaker(flow, vars, pick);
  if (flow.askEmail !== "off") {
    return out({ step: "awaiting_email", tries: 0 }, s, [talk.say("emailText")], `${note}; email asked`, talk);
  }
  return deliver(flow, vars, s, `${note}; link sent`, talk);
}

function askFollow(flow: Flow, vars: Vars, s: ConvState, deps: Deps): Outcome {
  const talk = speaker(flow, vars, deps.pick);
  return out(
    { step: "awaiting_follow", tries: 0, followAskedAt: deps.now },
    s,
    [talk.say("followText")],
    "follow asked",
    talk,
  );
}

/** The user wrote in: move the conversation one step. */
export async function advance(state: ConvState, text: string, flow: Flow, vars: Vars, deps: Deps): Promise<Outcome> {
  const talk = () => speaker(flow, vars, deps.pick);
  switch (state.step) {
    case "opened": {
      if (isNo(text)) return out({ step: "stopped" }, state, [], "declined at the opener");
      if (flow.requireFollow) return askFollow(flow, vars, state, deps);
      return afterFollow(flow, vars, state, "opener answered", deps.pick);
    }
    case "awaiting_follow": {
      const following = await deps.checkFollow();
      if (following === true) return afterFollow(flow, vars, state, "follow verified", deps.pick);
      // Unknown (the API can't tell): take their word when they say they followed.
      if (following === null && isYes(text) && !isNo(text)) {
        return afterFollow(flow, vars, state, "follow unverified, user said done", deps.pick);
      }
      const tries = state.tries + 1;
      const t = talk();
      if (tries >= flow.followMaxTries) {
        if (flow.followGiveUp === "send") {
          return deliver(flow, vars, { ...state, tries }, "follow gate given up, link sent anyway", t);
        }
        const stop = flow.followStopText ? [t.say("followStopText")] : [];
        return out({ step: "stopped", tries }, state, stop, "follow gate given up, stopped", t);
      }
      return out(
        { step: "awaiting_follow", tries },
        state,
        [t.say("followRetryText")],
        `not following yet (${tries}/${flow.followMaxTries})`,
        t,
      );
    }
    case "awaiting_email": {
      const t = talk();
      const email = extractEmail(text);
      if (email) return deliver(flow, vars, { ...state, email }, "email captured, link sent", t, true);
      if (flow.askEmail === "optional" || (isNo(text) && flow.askEmail !== "required")) {
        return deliver(flow, vars, state, "email skipped, link sent", t);
      }
      const tries = state.tries + 1;
      if (tries >= 3) {
        const stop = flow.emailStopText ? [t.say("emailStopText")] : [];
        return out({ step: "stopped", tries }, state, stop, "email required, not given, stopped", t);
      }
      return out({ step: "awaiting_email", tries }, state, [t.say("emailRetryText")], "email asked again", t);
    }
    default:
      return out({ step: state.step }, state, [], "conversation already finished");
  }
}

/** Follow question left unanswered past the timeout: send the link anyway (no email ask). Null when not due. */
export function timeoutFallback(state: ConvState, flow: Flow, vars: Vars, now: number, pick?: Picker): Outcome | null {
  if (state.step !== "awaiting_follow" || state.followAskedAt == null) return null;
  if (now - state.followAskedAt < flow.followTimeoutMin * 60_000) return null;
  const talk = speaker(flow, vars, pick);
  return out({ step: "done" }, state, [talk.say("followTimeoutText")], "follow timed out, link sent anyway", talk);
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
