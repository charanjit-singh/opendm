// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Account } from "../db/account";
import type { Rule } from "../db/rules";
import type { Vars } from "./flow";

/** Placeholder values for a rule's messages. */
export function buildVars(rule: Rule, account: Account, who: { name?: string; username?: string | null }, keyword: string): Vars {
  return {
    name: who.name,
    username: who.username ?? undefined,
    keyword,
    link: rule.link,
    account: account.username ?? undefined,
  };
}
