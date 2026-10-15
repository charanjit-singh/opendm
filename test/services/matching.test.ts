// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { describe, expect, it } from "vitest";
import { editDistance, matchKeyword, pickRule, splitKeywords, words } from "../../src/services/matching";

describe("words", () => {
  it("lowercases, folds accents, drops emoji and punctuation", () => {
    expect(words("GUÍDE 👀!! please")).toEqual(["guide", "please"]);
  });
});

describe("editDistance", () => {
  it("counts a swap of neighbours as one edit", () => {
    expect(editDistance("guide", "gudie")).toBe(1);
    expect(editDistance("guide", "guid")).toBe(1);
    expect(editDistance("abc", "xyz")).toBe(3);
  });
});

describe("matchKeyword", () => {
  const kws = ["GUIDE", "free trial"];
  it("matches a whole word in any case, inside a sentence", () => {
    expect(matchKeyword("Guide please!", kws)?.keyword).toBe("GUIDE");
    expect(matchKeyword("send me the guide 🙏 thanks so much", kws)?.keyword).toBe("GUIDE");
  });
  it("matches phrases", () => {
    expect(matchKeyword("I want the FREE TRIAL", kws)?.keyword).toBe("free trial");
  });
  it("does not match a keyword hidden inside another word", () => {
    expect(matchKeyword("guidelines are great", kws)).toBeNull();
  });
  it("is typo tolerant for short comments when fuzzy is on", () => {
    expect(matchKeyword("gude", kws, { fuzzy: true })).toEqual({ keyword: "GUIDE", fuzzy: "gude->GUIDE" });
    expect(matchKeyword("gudie", kws, { fuzzy: true })?.keyword).toBe("GUIDE");
  });
  it("is strict when fuzzy is off, and for long comments", () => {
    expect(matchKeyword("gude", kws)).toBeNull();
    expect(matchKeyword("this is such a gude post honestly", kws, { fuzzy: true })).toBeNull();
  });
  it("never fuzzy-matches everyday words", () => {
    expect(matchKeyword("like", ["lake"], { fuzzy: true })).toBeNull();
  });
  it("prefers the keyword mentioned first, and exact over typo", () => {
    expect(matchKeyword("free trial or guide", kws)?.keyword).toBe("free trial");
    expect(matchKeyword("gide guide", kws, { fuzzy: true })).toEqual({ keyword: "GUIDE" });
  });
  it("ignores empty keywords", () => {
    expect(matchKeyword("hello", ["", "  "])).toBeNull();
  });
});

describe("splitKeywords", () => {
  it("splits commas and newlines and trims", () => {
    expect(splitKeywords("A, b\n c ,,")).toEqual(["A", "b", "c"]);
  });
});

describe("pickRule", () => {
  const rule = (o: object) => ({ enabled: true, keywords: ["guide"], media_id: null, fuzzy: false, ...o });
  it("skips disabled rules", () => {
    expect(pickRule([rule({ enabled: false })], "guide")).toBeNull();
  });
  it("respects the post filter and prefers post-specific rules", () => {
    const all = rule({ name: "all" });
    const one = rule({ name: "one", media_id: "m1" });
    expect((pickRule([all, one], "guide", "m1")?.rule as any).name).toBe("one");
    expect((pickRule([all, one], "guide", "m2")?.rule as any).name).toBe("all");
    expect(pickRule([one], "guide", "m2")).toBeNull();
  });
});
