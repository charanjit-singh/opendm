// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { OpenDmClient } from "./client.ts";
import { tools } from "./tools.ts";

/** An MCP server exposing the OpenDM tools. Connect it to a transport (stdio in cli/mcp.ts). */
export function createMcpServer(client: OpenDmClient): McpServer {
  const server = new McpServer({ name: "opendm", version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(tool.name, { description: tool.description, inputSchema: tool.shape }, async (args) => {
      try {
        const text = await tool.run(client, args);
        return { content: [{ type: "text" as const, text }] };
      } catch (error) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: error instanceof Error ? error.message : String(error) }],
        };
      }
    });
  }
  return server;
}
