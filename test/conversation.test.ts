// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The whole journey through the real webhook handler: comment -> opener -> follow gate -> email -> link, with a fake Graph API.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { processFollowTimeouts } from "../src/engine";
import { runCron } from "../src/maintenance";
import { activeConversation } from "../src/store";
import { addRule, commentEvent, connect, dmEvent, mockGraph, postWebhook, resetDb, testEnv } from "./helpers";

const USER = "17841499999999991";
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  await resetDb();
  await connect();
});

const dms = (g: ReturnType<typeof mockGraph>) => g.sent().filter((s) => s.kind === "dm");

describe("follow gate + email + link", () => {
  it("walks a follower all the way to the link", async () => {
    await addRule({ flow: { requireFollow: true, askEmail: "optional" } });
    const g = mockGraph({ following: true, name: "Sam Rivera" });
    await postWebhook(commentEvent({ text: "GUIDE" }));
    expect(g.sent()[0].text).toContain("Want the link?");
    expect((await activeConversation(testEnv, USER))?.step).toBe("opened");

    await postWebhook(dmEvent({ text: "yes" }));
    expect(dms(g)[0]).toMatchObject({ to: USER });
    expect(dms(g)[0].text).toContain("follow @shop_account");
    expect((await activeConversation(testEnv, USER))?.step).toBe("awaiting_follow");

    await postWebhook(dmEvent({ text: "done" }));
    expect(dms(g)[1].text).toContain("what's your email");
    // The follow check really goes to the profile endpoint of that user:
    const check = g.calls.find((c) => c.url.pathname.endsWith(`/${USER}`));
    expect(check?.url.searchParams.get("fields")).toContain("is_user_follow_business");

    await postWebhook(dmEvent({ text: "sam@example.com" }));
    expect(dms(g).slice(2).map((d) => d.text)).toEqual(["Got it, thanks!", "Here you go:\nhttps://example.com/guide\nIf you get stuck, just reply here."]);
    expect(await activeConversation(testEnv, USER)).toBeNull();
    const row = await testEnv.DB.prepare("SELECT step, email FROM conversations").first<any>();
    expect(row).toEqual({ step: "done", email: "sam@example.com" });
  });

  it("uses the person's first name from the profile in the follow-up messages", async () => {
    await addRule({ flow: { requireFollow: true, followText: "Hi {name}, follow @{account} then say done" } });
    const g = mockGraph({ following: true, name: "Sam Rivera" });
    await postWebhook(commentEvent({ text: "GUIDE" }));
    await postWebhook(dmEvent({ text: "yes" }));
    expect(dms(g)[0].text).toBe("Hi Sam, follow @shop_account then say done");
  });

  it("holds the link back for someone who has not followed, until they do", async () => {
    await addRule({ flow: { requireFollow: true, askEmail: "off", followMaxTries: 3 } });
    let following = false;
    const g = mockGraph();
    g.on(/fields=name/, () => ({ name: "Sam", username: "sam", is_user_follow_business: following }));
    await postWebhook(commentEvent({ text: "GUIDE" }));
    await postWebhook(dmEvent({ text: "yes" }));
    await postWebhook(dmEvent({ text: "done" }));
    expect(dms(g).at(-1)!.text).toContain("can't see the follow");
    expect(dms(g).map((d) => d.text).join()).not.toContain("example.com/guide");
    following = true;
    await postWebhook(dmEvent({ text: "done now" }));
    expect(dms(g).at(-1)!.text).toContain("https://example.com/guide");
  });

  it("falls back to 'tap when done' when Meta does not return the follow status", async () => {
    await addRule({ flow: { requireFollow: true, askEmail: "off" } });
    const g = mockGraph({ following: null });
    await postWebhook(commentEvent({ text: "GUIDE" }));
    await postWebhook(dmEvent({ text: "yes" }));
    await postWebhook(dmEvent({ text: "done" }));
    expect(dms(g).at(-1)!.text).toContain("https://example.com/guide");
  });

  it("falls back the same way when the profile call itself fails", async () => {
    await addRule({ flow: { requireFollow: true, askEmail: "off" } });
    const g = mockGraph();
    g.on(/fields=name/, () => Response.json({ error: { message: "nope", code: 100 } }, { status: 400 }));
    await postWebhook(commentEvent({ text: "GUIDE" }));
    await postWebhook(dmEvent({ text: "yes" }));
    await postWebhook(dmEvent({ text: "done" }));
    expect(dms(g).at(-1)!.text).toContain("https://example.com/guide");
  });

  it("dedupes a DM that Meta delivers twice", async () => {
    await addRule({ flow: { requireFollow: false, askEmail: "off" } });
    const g = mockGraph();
    await postWebhook(commentEvent({ text: "GUIDE" }));
    const same = dmEvent({ text: "yes", mid: "m_same" });
    await postWebhook(same);
    await postWebhook(same);
    expect(dms(g)).toHaveLength(1);
  });

  it("keeps two people's conversations apart", async () => {
    await addRule({ flow: { requireFollow: false, askEmail: "off" } });
    const g = mockGraph();
    await postWebhook(commentEvent({ id: "a", text: "GUIDE", from: "u1", username: "one" }));
    await postWebhook(commentEvent({ id: "b", text: "GUIDE", from: "u2", username: "two" }));
    await postWebhook(dmEvent({ text: "yes", from: "u2" }));
    expect(dms(g)).toHaveLength(1);
    expect(dms(g)[0].to).toBe("u2");
    expect((await activeConversation(testEnv, "u1"))?.step).toBe("opened");
  });
});

describe("follow timeout (cron)", () => {
  it("sends the link anyway once the timeout has passed, and not before", async () => {
    await addRule({ flow: { requireFollow: true, askEmail: "optional", followTimeoutMin: 20 } });
    const g = mockGraph({ following: null });
    await postWebhook(commentEvent({ text: "GUIDE" }));
    await postWebhook(dmEvent({ text: "yes" }));
    const before = dms(g).length;

    await processFollowTimeouts(testEnv);
    expect(dms(g)).toHaveLength(before);

    await testEnv.DB.prepare("UPDATE conversations SET follow_asked_at = ?").bind(Date.now() - 21 * 60_000).run();
    expect(await processFollowTimeouts(testEnv)).toBe(1);
    expect(dms(g).at(-1)!.text).toBe("No worries if not, here's the link anyway:\nhttps://example.com/guide");
    expect(await activeConversation(testEnv, USER)).toBeNull();

    // Not sent twice.
    expect(await processFollowTimeouts(testEnv)).toBe(0);
  });

  it("is driven by the scheduled job", async () => {
    await addRule({ flow: { requireFollow: true, followTimeoutMin: 5 } });
    const g = mockGraph({ following: null });
    await postWebhook(commentEvent({ text: "GUIDE" }));
    await postWebhook(dmEvent({ text: "yes" }));
    await testEnv.DB.prepare("UPDATE conversations SET follow_asked_at = ?").bind(Date.now() - 6 * 60_000).run();
    const r = await runCron(testEnv);
    expect(r.timeouts).toBe(1);
    expect(dms(g).at(-1)!.text).toContain("example.com/guide");
  });
});
