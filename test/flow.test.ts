// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { describe, expect, it } from "vitest";
import { advance, DEFAULT_FLOW, extractEmail, fill, isNo, isYes, pickReply, resolveFlow, start, timeoutFallback, type ConvState, type Deps, type Flow } from "../src/flow";

const vars = { name: "Sam", username: "sam", keyword: "GUIDE", link: "https://example.com/g", account: "shop" };
const t0 = 1_000_000_000_000;
const deps = (following: boolean | null = null, now = t0): Deps => ({ checkFollow: async () => following, now });
const flow = (o: Partial<Flow> = {}): Flow => resolveFlow({ ...o });

/** Plays a whole conversation: returns every message sent and the final state. */
async function play(f: Flow, replies: string[], following: boolean | null = null) {
  let o = start(f, vars);
  const sent = [...o.messages];
  let state = o.state;
  for (const r of replies) {
    o = await advance(state, r, f, vars, deps(following));
    sent.push(...o.messages);
    state = o.state;
  }
  return { sent, state };
}

describe("placeholders", () => {
  it("fills known values and drops {name} cleanly", () => {
    expect(fill("Hey {name}! {keyword} -> {link}", vars)).toBe("Hey Sam! GUIDE -> https://example.com/g");
    expect(fill("Hey {name}!", { keyword: "x", link: "" })).toBe("Hey!");
    expect(fill("Hi {name}", { username: "sam", keyword: "k", link: "" })).toBe("Hi sam");
    expect(fill("{unknown} stays", vars)).toBe("{unknown} stays");
  });
});

describe("resolveFlow", () => {
  it("keeps defaults, validates types and clamps numbers", () => {
    const f = resolveFlow({ followMaxTries: 99, followTimeoutMin: 0, askEmail: "weird", followGiveUp: "stop", openerText: "  Hi  ", deliverText: "", nope: 1 });
    expect(f.followMaxTries).toBe(5);
    expect(f.followTimeoutMin).toBe(2);
    expect(f.askEmail).toBe(DEFAULT_FLOW.askEmail);
    expect(f.followGiveUp).toBe("stop");
    expect(f.openerText).toBe("Hi");
    expect(f.deliverText).toBe(DEFAULT_FLOW.deliverText);
    expect(resolveFlow(null)).toEqual(DEFAULT_FLOW);
  });
});

describe("reply detection", () => {
  it("isYes / isNo / extractEmail", () => {
    expect(isYes("yes please")).toBe(true);
    expect(isYes("👍")).toBe(true);
    expect(isYes("what is this?")).toBe(false);
    expect(isNo("nope")).toBe(true);
    expect(isNo("no thanks")).toBe(true);
    expect(isNo("I know a lot about this topic, no doubt it is great and I would love it")).toBe(false);
    expect(extractEmail("sure, it's Jo.Doe@Mail.com!")).toBe("jo.doe@mail.com");
    expect(extractEmail("no email")).toBeNull();
  });
});

describe("start", () => {
  it("sends the opener when the flow has gates or an opener", () => {
    const o = start(flow(), vars);
    expect(o.state.step).toBe("opened");
    expect(o.messages).toEqual(["Hey Sam! Saw your comment. Want the link? Just reply yes and I'll send it right here."]);
  });
  it("sends the link straight away with no opener and no gates", () => {
    const o = start(flow({ opener: false, requireFollow: false, askEmail: "off" }), vars);
    expect(o.state.step).toBe("done");
    expect(o.messages[0]).toContain("https://example.com/g");
  });
  it("still opens first when a gate needs the user's reply", () => {
    expect(start(flow({ opener: false, requireFollow: true }), vars).state.step).toBe("opened");
    expect(start(flow({ opener: false, requireFollow: false, askEmail: "optional" }), vars).state.step).toBe("opened");
  });
});

describe("opener -> link (no gates)", () => {
  const f = flow({ requireFollow: false, askEmail: "off" });
  it("delivers after the user replies", async () => {
    const { sent, state } = await play(f, ["yes"]);
    expect(state.step).toBe("done");
    expect(sent).toHaveLength(2);
    expect(sent[1]).toContain("https://example.com/g");
  });
  it("any answer that is not a no counts", async () => {
    expect((await play(f, ["what is it?"])).state.step).toBe("done");
  });
  it("a no ends it quietly", async () => {
    const { sent, state } = await play(f, ["no thanks"]);
    expect(state.step).toBe("stopped");
    expect(sent).toHaveLength(1);
  });
  it("ignores messages after it is done", async () => {
    const { sent } = await play(f, ["yes", "thanks!", "hello?"]);
    expect(sent).toHaveLength(2);
  });
});

describe("follow gate", () => {
  const f = flow({ requireFollow: true, askEmail: "off", followMaxTries: 2 });

  it("asks to follow after the opener reply, then delivers when the API says they follow", async () => {
    const { sent, state } = await play(f, ["yes", "done"], true);
    expect(sent[1]).toContain("follow @shop");
    expect(sent[2]).toContain("https://example.com/g");
    expect(state.step).toBe("done");
  });

  it("does not deliver while the API says they do not follow, then retries, then gives up and sends anyway", async () => {
    const r1 = await play(f, ["yes", "done"], false);
    expect(r1.state).toMatchObject({ step: "awaiting_follow", tries: 1 });
    expect(r1.sent.at(-1)).toContain("can't see the follow");
    expect(r1.sent.join("\n")).not.toContain("https://example.com/g");
    const r2 = await play(f, ["yes", "done", "done"], false);
    expect(r2.state.step).toBe("done");
    expect(r2.sent.at(-1)).toContain("https://example.com/g");
  });

  it("can stop politely instead of giving up with the link", async () => {
    const stop = flow({ requireFollow: true, askEmail: "off", followMaxTries: 1, followGiveUp: "stop" });
    const { sent, state } = await play(stop, ["yes", "done"], false);
    expect(state.step).toBe("stopped");
    expect(sent.at(-1)).toBe(DEFAULT_FLOW.followStopText);
    expect(sent.join("\n")).not.toContain("https://example.com/g");
  });

  it("when Meta cannot tell (null), takes their word on 'done'", async () => {
    const { sent, state } = await play(f, ["yes", "done"], null);
    expect(state.step).toBe("done");
    expect(sent.at(-1)).toContain("https://example.com/g");
  });

  it("when Meta cannot tell, a non-answer asks again", async () => {
    const { state } = await play(f, ["yes", "hmm what?"], null);
    expect(state).toMatchObject({ step: "awaiting_follow", tries: 1 });
  });

  it("records when the follow question was asked", async () => {
    const o = await advance(start(f, vars).state, "yes", f, vars, deps(null, t0 + 5));
    expect(o.state.followAskedAt).toBe(t0 + 5);
  });
});

describe("follow gate timeout", () => {
  const f = flow({ requireFollow: true, askEmail: "optional", followTimeoutMin: 20 });
  const waiting: ConvState = { step: "awaiting_follow", tries: 0, email: null, followAskedAt: t0 };

  it("does nothing before the timeout", () => {
    expect(timeoutFallback(waiting, f, vars, t0 + 19 * 60_000)).toBeNull();
  });
  it("sends the link anyway after the timeout, skipping the email ask", () => {
    const o = timeoutFallback(waiting, f, vars, t0 + 20 * 60_000)!;
    expect(o.state.step).toBe("done");
    expect(o.messages).toEqual(["No worries if not, here's the link anyway:\nhttps://example.com/g"]);
  });
  it("only applies to people waiting on the follow question", () => {
    expect(timeoutFallback({ ...waiting, step: "awaiting_email" }, f, vars, t0 + 999 * 60_000)).toBeNull();
    expect(timeoutFallback({ ...waiting, step: "done" }, f, vars, t0 + 999 * 60_000)).toBeNull();
    expect(timeoutFallback({ ...waiting, followAskedAt: null }, f, vars, t0 + 999 * 60_000)).toBeNull();
  });
});

describe("email capture", () => {
  it("optional: captures an email then delivers with a thank-you", async () => {
    const f = flow({ requireFollow: false, askEmail: "optional" });
    const { sent, state } = await play(f, ["yes", "it's Sam@Example.com"]);
    expect(state).toMatchObject({ step: "done", email: "sam@example.com" });
    expect(sent.at(-2)).toBe("Got it, thanks!");
    expect(sent.at(-1)).toContain("https://example.com/g");
  });
  it("optional: anything else skips and still delivers", async () => {
    const f = flow({ requireFollow: false, askEmail: "optional" });
    const { sent, state } = await play(f, ["yes", "no thanks"]);
    expect(state).toMatchObject({ step: "done", email: null });
    expect(sent.at(-1)).toContain("https://example.com/g");
  });
  it("required: asks again, then stops after three misses without the link", async () => {
    const f = flow({ requireFollow: false, askEmail: "required" });
    const { sent, state } = await play(f, ["yes", "nah", "nope", "no"]);
    expect(state.step).toBe("stopped");
    expect(sent.join("\n")).not.toContain("https://example.com/g");
    expect(sent.filter((m) => m === DEFAULT_FLOW.emailRetryText)).toHaveLength(2);
  });
  it("follow then email: the full path", async () => {
    const f = flow({ requireFollow: true, askEmail: "optional" });
    const { sent, state } = await play(f, ["yes", "done", "me@x.io"], true);
    expect(state).toMatchObject({ step: "done", email: "me@x.io" });
    expect(sent).toHaveLength(5);
  });
});

describe("pickReply", () => {
  it("avoids repeating the last line", () => {
    for (let i = 0; i < 20; i++) expect(pickReply(["a", "b"], "a")).toBe("b");
  });
  it("falls back to the only line, and to null for nothing", () => {
    expect(pickReply(["a"], "a")).toBe("a");
    expect(pickReply(["", "  "])).toBeNull();
  });
});
