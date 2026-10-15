#!/usr/bin/env node
// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// MCP server over stdio. Configure with OPENDM_URL and OPENDM_TOKEN (see .mcp.json).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "../src/mcp/client.ts";
import { createMcpServer } from "../src/mcp/server.ts";

/** `--url` and `--token` flags override OPENDM_URL / OPENDM_TOKEN (handy for `npx opendm-mcp --url ... --token ...`). */
function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

try {
  const env = {
    ...process.env,
    OPENDM_URL: flag("url") ?? process.env.OPENDM_URL,
    OPENDM_TOKEN: flag("token") ?? process.env.OPENDM_TOKEN,
  };
  await createMcpServer(clientFromEnv(env)).connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
