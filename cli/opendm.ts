#!/usr/bin/env node
// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { clientFromEnv } from "../src/mcp/client.ts";
import { EXIT, runCommand } from "./commands.ts";

const argv = process.argv.slice(2);
const json = argv.includes("--json");

try {
  const result = await runCommand(
    argv.filter((arg) => arg !== "--json"),
    clientFromEnv(),
  );
  console.log(json ? JSON.stringify(result.json, null, 2) : result.text);
  process.exitCode = result.exitCode;
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(json ? JSON.stringify({ ok: false, error: message }) : message);
  process.exitCode = EXIT.error;
}
