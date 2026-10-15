#!/usr/bin/env node
// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { clientFromEnv } from "./client.ts";
import { HELP, parseCommand, runCommand } from "./commands.ts";

try {
  const argv = process.argv.slice(2);
  const parsed = parseCommand(argv);
  console.log("help" in parsed ? HELP : await runCommand(argv, clientFromEnv()));
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
