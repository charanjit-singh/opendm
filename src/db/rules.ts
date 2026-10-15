// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { resolveFlow } from "../services/flow";
import type { Channel, Rule } from "../types/api";
import type { Env } from "../types/env";

export type { Rule };

/** What a rule stores. `flow` holds only the overrides the user set; defaults fill the rest when it is read. */
export interface RuleValues {
  name: string;
  keywords: string[];
  media_id: string | null;
  enabled: boolean;
  link: string;
  public_replies: string[];
  fuzzy: boolean;
  channel: Channel;
  dm_trigger: boolean;
  flow: Record<string, unknown>;
}

interface RuleRow {
  id: number;
  name: string;
  keywords: string;
  media_id: string | null;
  enabled: number;
  link: string;
  public_replies: string;
  flow: string;
  fuzzy: number;
  channel: Channel;
  dm_trigger: number;
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

const toRule = (r: RuleRow): Rule => {
  const flowRaw = parseJson<Record<string, unknown>>(r.flow, {});
  return {
    id: r.id,
    name: r.name,
    keywords: parseJson<string[]>(r.keywords, []),
    media_id: r.media_id || null,
    enabled: !!r.enabled,
    link: r.link,
    public_replies: parseJson<string[]>(r.public_replies, []),
    fuzzy: !!r.fuzzy,
    channel: r.channel,
    dm_trigger: !!r.dm_trigger,
    flow: resolveFlow(flowRaw, r.channel),
    flow_raw: flowRaw,
  };
};

export async function listRules(env: Env): Promise<Rule[]> {
  const { results } = await env.DB.prepare("SELECT * FROM rules ORDER BY id").all<RuleRow>();
  return results.map(toRule);
}

export async function getRule(env: Env, id: number): Promise<Rule | null> {
  const row = await env.DB.prepare("SELECT * FROM rules WHERE id = ?").bind(id).first<RuleRow>();
  return row ? toRule(row) : null;
}

const columns = (v: RuleValues) => [
  v.name,
  JSON.stringify(v.keywords),
  v.media_id,
  v.enabled ? 1 : 0,
  v.link,
  JSON.stringify(v.public_replies),
  JSON.stringify(v.flow),
  v.fuzzy ? 1 : 0,
  v.channel,
  v.dm_trigger ? 1 : 0,
];

export async function createRule(env: Env, values: RuleValues): Promise<number> {
  const now = Date.now();
  const result = await env.DB.prepare(
    "INSERT INTO rules (name, keywords, media_id, enabled, link, public_replies, flow, fuzzy, channel, dm_trigger, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  )
    .bind(...columns(values), now, now)
    .run();
  return result.meta.last_row_id as number;
}

export async function updateRule(env: Env, id: number, values: RuleValues): Promise<void> {
  await env.DB.prepare(
    "UPDATE rules SET name=?, keywords=?, media_id=?, enabled=?, link=?, public_replies=?, flow=?, fuzzy=?, channel=?, dm_trigger=?, updated=? WHERE id=?",
  )
    .bind(...columns(values), Date.now(), id)
    .run();
}

export async function deleteRule(env: Env, id: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM conversations WHERE rule_id = ?").bind(id),
    env.DB.prepare("DELETE FROM rules WHERE id = ?").bind(id),
  ]);
}
