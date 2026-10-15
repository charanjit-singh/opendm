// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// A remote MCP server (Streamable HTTP) on the Worker itself: connect Claude Desktop, Claude Code or any MCP client to
// https://<your-worker>/mcp with `Authorization: Bearer <ADMIN_PASSWORD>`. Stateless: one server per request.
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { OpenDmClient } from "../mcp/client.ts";
import { createMcpServer } from "../mcp/server.ts";
import { requireAdmin } from "../middleware/admin-auth";
import type { AppEnv } from "../types/app";
import type { Env } from "../types/env";

type SelfFetch = (request: Request, env: Env, ctx: unknown) => Response | Promise<Response>;

/** `selfFetch` runs requests through this same Worker, so the tools use the real admin API (one code path, tested once). */
export function mcpRoutes(selfFetch: SelfFetch) {
  const routes = new Hono<AppEnv>();
  routes.use("*", requireAdmin);

  routes.all("/", async (c) => {
    const token = c.req.header("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) return c.json({ error: "Use Authorization: Bearer <admin token> for /mcp" }, 401);
    const origin = new URL(c.req.url).origin;
    const client = new OpenDmClient(origin, token, (url, init) =>
      Promise.resolve(selfFetch(new Request(url, init), c.env, c.executionCtx)),
    );
    const server = createMcpServer(client);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return transport.handleRequest(c.req.raw);
  });
  return routes;
}
