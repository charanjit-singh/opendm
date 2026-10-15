#!/usr/bin/env node
// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// MCP server over stdio. Configure with OPENDM_URL and OPENDM_TOKEN (see .mcp.json).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "./client.ts";
import { createMcpServer } from "./mcp-server.ts";

try {
  await createMcpServer(clientFromEnv()).connect(new StdioServerTransport());
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
