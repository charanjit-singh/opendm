// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { classify } from "../src/graph";
import { backoffMs, dispatch, drainOutbox, hourlyLimit, MAX_ATTEMPTS, sentLastHour } from "../src/queue";
import { getSetting, recentEvents, setSetting } from "../src/store";
import { addRule, commentEvent, connect, mockGraph, postWebhook, resetDb, testEnv } from "./helpers";

beforeEach(async () => {
  vi.restoreAllMocks();
  await resetDb();
  await connect();
});

const outbox = () => testEnv.DB.prepare("SELECT * FROM outbox ORDER BY id").all<any>().then((r) => r.results);
const dm = (text: string, to = "u1") => dispatch(testEnv, { kind: "dm", userId: to, text, ctx: {} });

describe("classify (Graph error handling)", () => {
  it.each([
    [400, 190, "token"],
    [400, 102, "token"],
    [403, 10, "permission"],
    [400, 200, "permission"],
    [400, 4, "retry"],
    [400, 17, "retry"],
    [400, 613, "retry"],
    [400, 80006, "retry"],
    [429, undefined, "retry"],
    [503, undefined, "retry"],
    [400, 100, "final"],
    [400, 1, "final"],
    [400, undefined, "final"],
  ] as const)("HTTP %i code %s -> %s", (status, code, kind) => {
    expect(classify(status, code === undefined ? undefined : { code })).toBe(kind);
  });
});

describe("hourly cap", () => {
  it("sends up to the cap, queues the rest, and drains them as the window frees up", async () => {
    await setSetting(testEnv, "hourly_limit", "3");
    const g = mockGraph();
    const out = [];
    for (let i = 0; i < 5; i++) out.push(await dm(`msg ${i}`));
    expect(out).toEqual(["sent", "sent", "sent", "queued", "queued"]);
    expect(g.sent().map((s) => s.text)).toEqual(["msg 0", "msg 1", "msg 2"]);
    expect(await sentLastHour(testEnv)).toBe(3);
    expect((await outbox()).filter((o) => o.status === "pending")).toHaveLength(2);

    // Nothing is due yet, and even when due the cap still holds.
    expect(await drainOutbox(testEnv)).toBe(0);
    await testEnv.DB.prepare("UPDATE outbox SET due = 0").run();
    expect(await drainOutbox(testEnv)).toBe(0);
    expect(g.sent()).toHaveLength(3);

    // An hour later the window is empty.
    await testEnv.DB.prepare("UPDATE sends SET ts = ts - 3700000").run();
    expect(await drainOutbox(testEnv)).toBe(2);
    expect(g.sent().map((s) => s.text)).toEqual(["msg 0", "msg 1", "msg 2", "msg 3", "msg 4"]);
  });

  it("uses a sane default and ignores a bad setting", async () => {
    expect(await hourlyLimit(testEnv)).toBe(150);
    await setSetting(testEnv, "hourly_limit", "-5");
    expect(await hourlyLimit(testEnv)).toBe(150);
  });

  it("a burst of comments over the cap queues the replies instead of dropping them", async () => {
    await setSetting(testEnv, "hourly_limit", "2");
    await addRule();
    const g = mockGraph();
    for (const id of ["a", "b"]) await postWebhook(commentEvent({ id, text: "GUIDE", from: `u${id}` }));
    expect(g.sent()).toHaveLength(2);
    expect((await outbox()).length).toBeGreaterThan(0);
    expect((await recentEvents(testEnv, 20)).some((e: any) => e.status === "queued" && /cap/.test(e.error))).toBe(true);
  });
});

describe("errors", () => {
  it("retries transient errors with backoff, then gives up", async () => {
    const g = mockGraph();
    g.on(/\/messages$/, () => Response.json({ error: { message: "Rate limit", code: 4 } }, { status: 429 }));
    expect(await dm("hello")).toBe("queued");
    for (let i = 1; i < MAX_ATTEMPTS; i++) {
      const [row] = (await outbox()).filter((o) => o.status === "pending");
      expect(row.attempts).toBe(i);
      expect(row.due - Date.now()).toBeGreaterThan(backoffMs(i) - 5000);
      await testEnv.DB.prepare("UPDATE outbox SET due = 0").run();
      await drainOutbox(testEnv);
    }
    expect((await outbox()).filter((o) => o.status === "pending")).toHaveLength(0);
    expect((await recentEvents(testEnv, 1))[0]).toMatchObject({ status: "error" });
    expect(g.calls).toHaveLength(MAX_ATTEMPTS);
  });

  it("recovers when the retry succeeds", async () => {
    const g = mockGraph();
    let first = true;
    g.on(/\/messages$/, () => (first ? ((first = false), Response.json({ error: { message: "try later", code: 2 } }, { status: 500 })) : undefined));
    expect(await dm("hi")).toBe("queued");
    await testEnv.DB.prepare("UPDATE outbox SET due = 0").run();
    await drainOutbox(testEnv);
    expect(g.sent().map((s) => s.text)).toEqual(["hi", "hi"]);
    expect((await recentEvents(testEnv, 1))[0].status).toBe("sent");
  });

  it("flags the account when the token is bad, and does not retry", async () => {
    const g = mockGraph();
    g.on(/\/messages$/, () => Response.json({ error: { message: "Invalid OAuth access token.", code: 190 } }, { status: 401 }));
    expect(await dm("hi")).toBe("error");
    expect(await getSetting(testEnv, "token_error")).toContain("Invalid OAuth access token");
    expect(await outbox()).toHaveLength(0);
  });

  it("does not retry a final error such as a closed messaging window", async () => {
    const g = mockGraph();
    g.on(/\/messages$/, () => Response.json({ error: { message: "This person isn't available right now.", code: 100, error_subcode: 2534014 } }, { status: 400 }));
    expect(await dm("hi")).toBe("error");
    expect(await outbox()).toHaveLength(0);
  });

  it("treats a network failure as transient", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("connection reset"));
    expect(await dm("hi")).toBe("queued");
  });

  it("never puts the token in the log", async () => {
    const g = mockGraph();
    g.on(/\/messages$/, () => Response.json({ error: { message: "bad token IGAAtesttoken000000000000000000000000 x", code: 190 } }, { status: 401 }));
    await dm("hi");
    const text = JSON.stringify(await recentEvents(testEnv, 10)) + (await getSetting(testEnv, "token_error"));
    expect(text).not.toContain("IGAAtesttoken");
  });
});
