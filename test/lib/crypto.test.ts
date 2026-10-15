// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { describe, expect, it } from "vitest";
import { makeToken, readToken, safeEqual, scrub, seal, sign, unseal, verifySignature } from "../../src/lib/crypto";

const enc = (s: string) => new TextEncoder().encode(s);

describe("webhook signature (X-Hub-Signature-256)", () => {
  const body = '{"object":"instagram"}';
  it("accepts the right HMAC-SHA256 of the raw body", async () => {
    expect(await verifySignature("secret", enc(body), await sign("secret", body))).toBe(true);
  });
  it("matches a known HMAC vector", async () => {
    expect(await sign("key", "The quick brown fox jumps over the lazy dog")).toBe(
      "sha256=f7bc83f430538424b13298e6aa6fb143ef4d59a14946175997479dbc2d1a3cd8",
    );
  });
  it("rejects a wrong secret, a changed body, a missing or malformed header", async () => {
    const good = await sign("secret", body);
    expect(await verifySignature("other", enc(body), good)).toBe(false);
    expect(await verifySignature("secret", enc(`${body} `), good)).toBe(false);
    expect(await verifySignature("secret", enc(body), null)).toBe(false);
    expect(await verifySignature("secret", enc(body), good.replace("sha256=", "sha1="))).toBe(false);
    expect(await verifySignature("secret", enc(body), "sha256=zz")).toBe(false);
    expect(await verifySignature("secret", enc(body), "sha256=abcd")).toBe(false);
  });
  it("rejects everything when no secret is configured", async () => {
    expect(await verifySignature(undefined, enc(body), `sha256=${"00".repeat(32)}`)).toBe(false);
  });
});

describe("tokens", () => {
  it("round-trips and expires", async () => {
    const t = await makeToken("s3cret", "admin", 60, 1_000_000);
    expect(await readToken("s3cret", t, 1_000_000 + 30_000)).toBe("admin");
    expect(await readToken("s3cret", t, 1_000_000 + 61_000)).toBeNull();
  });
  it("rejects tampering and other secrets", async () => {
    const t = await makeToken("s3cret", "admin", 60);
    expect(await readToken("other", t)).toBeNull();
    expect(await readToken("s3cret", t.replace(/^./, "x"))).toBeNull();
    expect(await readToken("s3cret", "garbage")).toBeNull();
    expect(await readToken("s3cret", undefined)).toBeNull();
  });
});

describe("seal", () => {
  it("encrypts with the secret and refuses a different one", async () => {
    const sealed = await seal("k", "IGAAsecret");
    expect(sealed).not.toContain("IGAA");
    expect(await unseal("k", sealed)).toBe("IGAAsecret");
    expect(await unseal("other", sealed)).toBeNull();
    expect(await unseal("k", null)).toBeNull();
  });
});

describe("safeEqual + scrub", () => {
  it("compares strings", async () => {
    expect(await safeEqual("abc", "abc")).toBe(true);
    expect(await safeEqual("abc", "abd")).toBe(false);
    expect(await safeEqual("abc", "abcd")).toBe(false);
  });
  it("hides tokens in error text", () => {
    expect(scrub("bad token IGAAabcdefghijklmnopqrstuvwxyz1234 here")).toBe("bad token [token] here");
    expect(scrub("my-long-secret-value failed", ["my-long-secret-value"])).toBe("[token] failed");
  });
});
