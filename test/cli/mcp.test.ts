// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The MCP server end to end: a real MCP client talks to our server, which talks to the Worker.
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../../cli/mcp-server.ts";
import { resetDb, workerClient } from "../support/helpers.ts";

async function connectClient(token?: string) {
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await createMcpServer(workerClient(token)).connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  return client;
}

const text = (result: Awaited<ReturnType<Client["callTool"]>>) => (result.content as { text: string }[])[0].text;

describe("MCP server", () => {
  beforeEach(resetDb);

  it("lists the OpenDM tools with input schemas", async () => {
    const { tools } = await (await connectClient()).listTools();
    expect(tools.map((t) => t.name)).toContain("opendm_create_rule");
    const create = tools.find((t) => t.name === "opendm_create_rule");
    expect(Object.keys(create?.inputSchema.properties ?? {})).toEqual(
      expect.arrayContaining(["keywords", "link", "requireFollow", "askEmail"]),
    );
  });

  it("creates a flow and dry-runs it, like Claude would", async () => {
    const client = await connectClient();
    const created = await client.callTool({
      name: "opendm_create_rule",
      arguments: { keywords: ["AUTOMATION"], link: "https://example.com/guide", requireFollow: true },
    });
    expect(created.isError).toBeFalsy();
    expect(text(created)).toContain("keywords: AUTOMATION");

    const tested = await client.callTool({
      name: "opendm_test_comment",
      arguments: { comment: "AUTOMATION", replies: ["yes", "done"], following: "yes" },
    });
    expect(text(tested)).toContain("https://example.com/guide");
  });

  it("reports failures as tool errors, not crashes", async () => {
    const client = await connectClient();
    const bad = await client.callTool({ name: "opendm_create_rule", arguments: { link: "https://example.com" } });
    expect(bad.isError).toBe(true);
    expect(text(bad)).toMatch(/keywords/);
    const wrongToken = await (await connectClient("wrong")).callTool({ name: "opendm_status", arguments: {} });
    expect(wrongToken.isError).toBe(true);
    expect(text(wrongToken)).toBe("Wrong password");
  });
});
