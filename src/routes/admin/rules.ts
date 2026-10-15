// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { createRule, deleteRule, getRule, listRules, updateRule } from "../../db/rules";
import { ApiError, parseBody } from "../../lib/validate";
import type { AppEnv } from "../../types/app";
import { ruleSchema } from "../schemas";

export const ruleRoutes = new Hono<AppEnv>();

ruleRoutes.get("/", async (c) => c.json({ rules: await listRules(c.env) }));

ruleRoutes.post("/", async (c) => {
  const values = await parseBody(c, ruleSchema);
  const id = await createRule(c.env, values);
  return c.json({ rule: await getRule(c.env, id) }, 201);
});

/** Loads the rule named in the URL or throws 404. */
async function existingRule(env: AppEnv["Bindings"], idParam: string) {
  const rule = await getRule(env, Number(idParam));
  if (!rule) throw new ApiError(404, "Rule not found");
  return rule;
}

ruleRoutes.get("/:id{[0-9]+}", async (c) => c.json({ rule: await existingRule(c.env, c.req.param("id")) }));

ruleRoutes.put("/:id{[0-9]+}", async (c) => {
  const { id } = await existingRule(c.env, c.req.param("id"));
  await updateRule(c.env, id, await parseBody(c, ruleSchema));
  return c.json({ rule: await getRule(c.env, id) });
});

ruleRoutes.delete("/:id{[0-9]+}", async (c) => {
  const { id } = await existingRule(c.env, c.req.param("id"));
  await deleteRule(c.env, id);
  return c.json({ deleted: id });
});
