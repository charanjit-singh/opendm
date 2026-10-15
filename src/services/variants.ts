// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// Message cycling: which wording of a message goes out next. Round-robin counters live in D1 per rule and message.
import type { Env } from "../types/env";
import type { Picker, Rotation, SentVariant } from "./flow";

export interface RulePicker {
  pick: Picker;
  /** Saves the round-robin counters that moved. Call once after the messages were chosen. */
  commit: () => Promise<void>;
}

/** The key used for the public comment replies. */
export const PUBLIC_KEY = "public";

export async function createPicker(env: Env, ruleId: number, rotation: Rotation): Promise<RulePicker> {
  const counters = new Map<string, number>();
  const moved = new Set<string>();
  if (rotation === "round_robin") {
    const { results } = await env.DB.prepare("SELECT key, n FROM variant_counters WHERE rule_id = ?")
      .bind(ruleId)
      .all<{ key: string; n: number }>();
    for (const row of results) counters.set(row.key, row.n);
  }
  const pick: Picker = (key, count) => {
    if (rotation === "random") return Math.floor(Math.random() * count);
    const n = counters.get(key) ?? 0;
    counters.set(key, n + 1);
    moved.add(key);
    return n % count;
  };
  const commit = async () => {
    if (!moved.size) return;
    await env.DB.batch(
      [...moved].map((key) =>
        env.DB.prepare(
          "INSERT INTO variant_counters (rule_id, key, n) VALUES (?,?,?) ON CONFLICT(rule_id, key) DO UPDATE SET n = excluded.n",
        ).bind(ruleId, key, counters.get(key) ?? 0),
      ),
    );
    moved.clear();
  };
  return { pick, commit };
}

/** Picks one of several public replies with the same picker the DMs use. Null when there are none. */
export function pickPublicReply(lines: string[], pick: Picker): { text: string; variant: SentVariantLabel } | null {
  const list = lines.filter((line) => line.trim());
  if (!list.length) return null;
  const index = list.length > 1 ? pick(PUBLIC_KEY, list.length) : 0;
  return { text: list[index], variant: label(PUBLIC_KEY, index, list.length) };
}

export type SentVariantLabel = string | null;

/** "openerText#2/3" (1-based), or null when the message has a single wording. */
export function label(key: string, index: number, total: number): string | null {
  return total > 1 ? `${key}#${index + 1}/${total}` : null;
}

export const labelOf = (v: SentVariant | undefined): string | null => (v ? label(v.key, v.index, v.total) : null);
