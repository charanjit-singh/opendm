// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The MCP server that lives on the Worker itself (Streamable HTTP at /mcp), used by Claude Desktop / Code / any MCP client.
import { beforeEach, describe, expect, it } from "vitest";
import { addRule, login, request, resetDb, testEnv } from "../support/helpers.ts";

const rpc = (method: string, params: unknown, id = 1, auth: string | null = `Bearer ${testEnv.ADMIN_PASSWORD}`) =>
  request("/mcp", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...(auth ? { Authorization: auth } : {}),
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });

const json = async (res: Response): Promise<any> => res.json();

beforeEach(resetDb);

describe("remote MCP endpoint (/mcp)", () => {
  it("rejects missing and wrong tokens, and cookie-only sessions", async () => {
    expect((await rpc("tools/list", {}, 1, null)).status).toBe(401);
    expect((await rpc("tools/list", {}, 1, "Bearer nope")).status).toBe(401);
    const { cookie } = await login();
    const res = await request("/mcp", {
      method: "POST",
      headers: { Cookie: cookie, "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  it("initializes and lists every tool", async () => {
    const init = await rpc("initialize", {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "test", version: "0" },
    });
    expect(init.status).toBe(200);
    expect((await json(init)).result.serverInfo.name).toBe("opendm");
    const list = await json(await rpc("tools/list", {}, 2));
    const names = list.result.tools.map((t: { name: string }) => t.name);
    expect(names.length).toBeGreaterThanOrEqual(29);
    expect(names).toEqual(
      expect.arrayContaining(["opendm_create_rule", "opendm_setup_status", "opendm_set_messages", "opendm_list_leads"]),
    );
  });

  it("runs tools against the live data (same code path as the admin API)", async () => {
    await addRule({ keywords: ["REMOTE"] });
    const res = await rpc("tools/call", { name: "opendm_list_rules", arguments: {} }, 3);
    const out = (await json(res)).result;
    expect(out.isError).toBeFalsy();
    expect(out.content[0].text).toContain("keywords: REMOTE");

    const created = (await (
      await rpc(
        "tools/call",
        {
          name: "opendm_create_rule",
          arguments: { keywords: ["VIAMCP"], link: "https://example.com/m", requireFollow: true },
        },
        4,
      )
    ).json()) as { result: { content: { text: string }[] } };
    expect(created.result.content[0].text).toContain("VIAMCP");
    const test = (await (
      await rpc(
        "tools/call",
        { name: "opendm_test_comment", arguments: { comment: "viamcp", replies: ["yes", "done"], following: "yes" } },
        5,
      )
    ).json()) as { result: { content: { text: string }[] } };
    expect(test.result.content[0].text).toContain("https://example.com/m");
  });

  it("returns tool errors as results, not HTTP failures", async () => {
    const res = await rpc("tools/call", { name: "opendm_get_rule", arguments: { id: 12345 } }, 6);
    expect(res.status).toBe(200);
    const out = (await json(res)).result;
    expect(out.isError).toBe(true);
    expect(out.content[0].text).toBe("Rule not found");
  });
});
