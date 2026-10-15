// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Message cycling: every message can have several wordings, rotated round-robin or at random, and the log says which one went out.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { recentEvents } from "../../src/db/events";
import {
  advance,
  type ConvState,
  firstVariant,
  type Picker,
  resolveFlow,
  start,
  startFromDm,
  timeoutFallback,
  variantsOf,
} from "../../src/services/flow";
import { createPicker, label, pickPublicReply } from "../../src/services/variants";
import { addRule, commentEvent, connect, dmEvent, mockGraph, postWebhook, resetDb, testEnv } from "../support/helpers";

const vars = { name: "Sam", keyword: "GUIDE", link: "https://x.io", account: "shop" };
const cycle = (): Picker => {
  const n: Record<string, number> = {};
  return (key, count) => {
    n[key] = (n[key] ?? -1) + 1;
    return n[key] % count;
  };
};

describe("flow variants", () => {
  it("uses the single text when there are no variants, and variants when set", () => {
    const flow = resolveFlow({ openerText: "One", variants: { openerText: ["A", "B", "C"] } });
    expect(variantsOf(flow, "openerText")).toEqual(["A", "B", "C"]);
    expect(variantsOf(flow, "deliverText")).toEqual([flow.deliverText]);
  });

  it("cleans variants: trims, drops blanks, caps the count, ignores unknown keys", () => {
    const flow = resolveFlow({
      variants: {
        openerText: [" a ", "", "b"],
        nope: ["x"],
        deliverText: Array.from({ length: 30 }, (_, i) => `v${i}`),
      },
    });
    expect(flow.variants.openerText).toEqual(["a", "b"]);
    expect(flow.variants.deliverText).toHaveLength(10);
    expect(Object.keys(flow.variants)).toEqual(["openerText", "deliverText"]);
    expect(resolveFlow({ rotation: "random" }).rotation).toBe("random");
    expect(resolveFlow({ rotation: "weird" }).rotation).toBe("round_robin");
  });

  it("start() picks the variant and reports which one", () => {
    const flow = resolveFlow({ variants: { openerText: ["Hi {name}", "Hey {name}", "Yo {name}"] } });
    const pick = cycle();
    expect(start(flow, vars, pick).messages).toEqual(["Hi Sam"]);
    const second = start(flow, vars, pick);
    expect(second.messages).toEqual(["Hey Sam"]);
    expect(second.variants).toEqual([{ key: "openerText", index: 1, total: 3 }]);
    expect(start(flow, vars, pick).messages).toEqual(["Yo Sam"]);
    expect(start(flow, vars, pick).messages).toEqual(["Hi Sam"]);
  });

  it("without a picker the first wording is used", () => {
    const flow = resolveFlow({ variants: { openerText: ["First", "Second"] } });
    expect(start(flow, vars).messages).toEqual(["First"]);
    expect(start(flow, vars, firstVariant).variants[0].index).toBe(0);
  });

  it("a picker that returns nonsense is clamped into range", () => {
    const flow = resolveFlow({ variants: { openerText: ["a", "b"] } });
    expect(start(flow, vars, () => 99).messages).toEqual(["b"]);
    expect(start(flow, vars, () => -5).messages).toEqual(["a"]);
  });

  it("every step of the flow cycles its own messages", async () => {
    const flow = resolveFlow({
      askEmail: "optional",
      variants: {
        followText: ["F1", "F2"],
        followRetryText: ["R1", "R2"],
        emailText: ["E1", "E2"],
        emailThanks: ["T1", "T2"],
        deliverText: ["D1 {link}", "D2 {link}"],
        followTimeoutText: ["X1", "X2"],
      },
    });
    const pick = cycle();
    const deps = { checkFollow: async () => false as boolean | null, now: 1, pick };
    const opened: ConvState = { step: "opened", tries: 0, email: null, followAskedAt: null };
    const asked = await advance(opened, "yes", flow, vars, deps);
    expect(asked.messages).toEqual(["F1"]);
    const retry = await advance(asked.state, "done", flow, vars, deps);
    expect(retry.messages).toEqual(["R1"]);
    const unknownFollow = { ...deps, checkFollow: async () => null };
    const email = await advance(retry.state, "done", flow, vars, unknownFollow);
    expect(email.messages).toEqual(["E1"]);
    const done = await advance(email.state, "me@x.io", flow, vars, deps);
    expect(done.messages).toEqual(["T1", "D1 https://x.io"]);
    expect(done.variants.map((v) => v.index)).toEqual([0, 0]);
    const timeout = timeoutFallback({ ...asked.state }, flow, vars, 1 + 60 * 60_000, pick);
    expect(timeout?.messages).toEqual(["X1"]);
    expect(start(flow, vars, pick).state.step).toBe("opened");
  });

  it("a keyword DM skips the opener (the window is already open) and goes to the first gate", async () => {
    const flow = resolveFlow({ requireFollow: true });
    const out = await startFromDm(flow, "GUIDE", vars, { checkFollow: async () => null, now: 5 });
    expect(out.state).toMatchObject({ step: "awaiting_follow", followAskedAt: 5 });
    expect(out.messages[0]).toContain("follow @shop");
    const direct = await startFromDm(
      resolveFlow({ opener: false, requireFollow: false, askEmail: "off" }),
      "GUIDE",
      vars,
      { checkFollow: async () => null, now: 5 },
    );
    expect(direct.state.step).toBe("done");
    expect(direct.messages[0]).toContain("https://x.io");
  });
});

describe("rule pickers (D1 counters)", () => {
  beforeEach(resetDb);

  it("round-robin continues across picker instances and survives restarts", async () => {
    const seen: number[] = [];
    for (let i = 0; i < 5; i++) {
      const picker = await createPicker(testEnv, 7, "round_robin");
      seen.push(picker.pick("openerText", 3));
      await picker.commit();
    }
    expect(seen).toEqual([0, 1, 2, 0, 1]);
    // Counters are per rule and per message.
    const other = await createPicker(testEnv, 8, "round_robin");
    expect(other.pick("openerText", 3)).toBe(0);
    const same = await createPicker(testEnv, 7, "round_robin");
    expect(same.pick("deliverText", 3)).toBe(0);
  });

  it("random stays in range and writes no counters", async () => {
    const picker = await createPicker(testEnv, 1, "random");
    const picks = Array.from({ length: 50 }, () => picker.pick("x", 4));
    expect(Math.min(...picks)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...picks)).toBeLessThan(4);
    await picker.commit();
    expect((await testEnv.DB.prepare("SELECT COUNT(*) AS n FROM variant_counters").first<{ n: number }>())?.n).toBe(0);
  });

  it("public replies cycle and label themselves", async () => {
    const picker = await createPicker(testEnv, 2, "round_robin");
    const lines = ["one", "two"];
    expect(pickPublicReply(lines, picker.pick)).toEqual({ text: "one", variant: "public#1/2" });
    expect(pickPublicReply(lines, picker.pick)?.text).toBe("two");
    expect(pickPublicReply(["only"], picker.pick)).toEqual({ text: "only", variant: null });
    expect(pickPublicReply(["", " "], picker.pick)).toBeNull();
    expect(label("openerText", 0, 1)).toBeNull();
  });
});

describe("cycling through the webhook", () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await resetDb();
    await connect();
  });

  it("alternates the opener and the public reply across comments, and logs the wording used", async () => {
    await addRule({
      public_replies: ["P1", "P2"],
      flow: { variants: { openerText: ["Opener one", "Opener two"] } },
    });
    const g = mockGraph();
    for (const id of ["a", "b", "c"]) await postWebhook(commentEvent({ id, text: "GUIDE", from: `u${id}` }));
    const sent = g.sent();
    expect(sent.filter((s) => s.kind === "private_reply").map((s) => s.text)).toEqual([
      "Opener one",
      "Opener two",
      "Opener one",
    ]);
    expect(sent.filter((s) => s.kind === "public_reply").map((s) => s.text)).toEqual(["P1", "P2", "P1"]);
    const log = await recentEvents(testEnv, 20);
    const variants = log.filter((e) => e.status === "sent").map((e) => e.variant);
    expect(variants).toContain("openerText#2/2");
    expect(variants).toContain("public#2/2");
  });

  it("a conversation's later messages cycle too", async () => {
    await addRule({
      flow: { requireFollow: false, askEmail: "off", variants: { deliverText: ["Link A {link}", "Link B {link}"] } },
    });
    const g = mockGraph();
    for (const u of ["u1", "u2"]) {
      await postWebhook(commentEvent({ id: `c-${u}`, text: "GUIDE", from: u }));
      await postWebhook(dmEvent({ text: "yes", from: u }));
    }
    expect(
      g
        .sent()
        .filter((s) => s.kind === "dm")
        .map((s) => s.text),
    ).toEqual(["Link A https://example.com/guide", "Link B https://example.com/guide"]);
  });

  it("random rotation never sends a wording that does not exist", async () => {
    await addRule({ flow: { rotation: "random", variants: { openerText: ["a", "b", "c"] } } });
    const g = mockGraph();
    for (let i = 0; i < 10; i++) await postWebhook(commentEvent({ id: `r${i}`, text: "GUIDE", from: `u${i}` }));
    for (const s of g.sent().filter((x) => x.kind === "private_reply")) expect(["a", "b", "c"]).toContain(s.text);
  });
});
