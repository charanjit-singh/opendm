// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// A minimal long-flag parser: "--key value", "--switch", everything else is a positional argument.

/** Flags that take no value. Every other known --flag takes the next argument. */
const SWITCHES = new Set([
  "no-typos",
  "follow",
  "no-follow",
  "no-opener",
  "disable",
  "enable",
  "json",
  "yes",
  "dm-trigger",
  "no-dm-trigger",
]);

const VALUE_FLAGS = new Set([
  "keywords",
  "link",
  "name",
  "post",
  "replies",
  "timeout",
  "email",
  "opener",
  "follow-text",
  "email-text",
  "final",
  "following",
  "wait",
  "limit",
  "kind",
  "platform",
  "channel",
  "app-id",
  "app-secret",
  "token",
  "page-id",
  "rotation",
  "messages",
  "variant",
  "step",
]);

export type FlagValues = Record<string, string | boolean | undefined>;

export interface ParsedArgs {
  values: FlagValues;
  positionals: string[];
}

export function parseArgs(argv: string[]): ParsedArgs {
  const values: FlagValues = {};
  const positionals: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      positionals.push(arg);
      continue;
    }
    const key = arg.slice(2);
    if (SWITCHES.has(key)) {
      values[key] = true;
    } else if (VALUE_FLAGS.has(key)) {
      const value = argv[++i];
      if (value === undefined) throw new Error(`--${key} needs a value`);
      values[key] = value;
    } else {
      throw new Error(`Unknown option --${key}. Run: opendm help`);
    }
  }
  return { values, positionals };
}

export const list = (value: string | boolean | undefined, separator = ","): string[] | undefined =>
  typeof value !== "string"
    ? undefined
    : value
        .split(separator)
        .map((part) => part.trim())
        .filter(Boolean);

export const numberOf = (value: string | boolean | undefined): number | undefined =>
  typeof value !== "string" ? undefined : Number(value);

export const stringOf = (value: string | boolean | undefined): string | undefined =>
  typeof value === "string" ? value : undefined;
