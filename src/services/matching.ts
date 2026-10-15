// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.

/** Words of a text: lower-case letters/digits, accents folded, emoji and punctuation dropped ("LINK 👀!!" -> ["link"]). */
export function words(text: string): string[] {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Optimal string alignment distance: insert, delete, substitute or swap two neighbours each cost 1. */
export function editDistance(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  }
  return d[a.length][b.length];
}

/** Everyday words one typo away from a common keyword. Never matched fuzzily. */
const NOT_A_TYPO = new Set([
  "yes",
  "yeah",
  "see",
  "the",
  "ok",
  "okay",
  "wow",
  "nice",
  "love",
  "cool",
  "lol",
  "link",
  "line",
  "like",
]);

export interface KeywordMatch {
  keyword: string;
  /** Set when matched through typo tolerance, e.g. "guid->guide". */
  fuzzy?: string;
}

/**
 * Which keyword a comment asks for.
 *  - A whole word (or phrase) equal to a keyword always matches. Case, accents, emoji and punctuation are ignored.
 *  - With `fuzzy`, short comments (up to 4 words) also match one typo away (two for keywords of 6+ letters).
 * The first keyword mentioned in the text wins; an exact match beats a typo.
 */
export function matchKeyword(text: string, keywords: string[], opts: { fuzzy?: boolean } = {}): KeywordMatch | null {
  const w = words(text);
  let best: { keyword: string; at: number } | null = null;
  for (const keyword of keywords) {
    const k = words(keyword);
    if (!k.length) continue;
    for (let i = 0; i + k.length <= w.length; i++) {
      if (k.every((x, j) => w[i + j] === x)) {
        if (!best || i < best.at) best = { keyword, at: i };
        break;
      }
    }
  }
  if (best) return { keyword: best.keyword };
  if (!opts.fuzzy || w.length > 4) return null;
  let found: { keyword: string; at: number; d: number; word: string } | null = null;
  w.forEach((word, at) => {
    if (word.length < 3 || NOT_A_TYPO.has(word)) return;
    for (const keyword of keywords) {
      const k = words(keyword);
      if (k.length !== 1 || k[0].length < 4) continue;
      const d = editDistance(word, k[0]);
      if (d <= (k[0].length <= 5 ? 1 : 2) && (!found || d < found.d || (d === found.d && at < found.at)))
        found = { keyword, at, d, word };
    }
  });
  const f = found as { keyword: string; word: string } | null;
  return f ? { keyword: f.keyword, fuzzy: `${f.word}->${f.keyword}` } : null;
}

export const splitKeywords = (s: string | string[]) =>
  (Array.isArray(s) ? s : s.split(/[,\n]/)).map((x) => x.trim()).filter(Boolean);

/** Which rule fires for a comment on a given media: the first enabled rule (post-specific rules first) that matches. */
export function pickRule<R extends { enabled: boolean; keywords: string[]; media_id: string | null; fuzzy: boolean }>(
  rules: R[],
  text: string,
  mediaId?: string,
): { rule: R; match: KeywordMatch } | null {
  const ordered = [...rules].sort((a, b) => Number(!!b.media_id) - Number(!!a.media_id));
  for (const rule of ordered) {
    if (!rule.enabled) continue;
    if (rule.media_id && rule.media_id !== mediaId) continue;
    const match = matchKeyword(text, rule.keywords, { fuzzy: rule.fuzzy });
    if (match) return { rule, match };
  }
  return null;
}
