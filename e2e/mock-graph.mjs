// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// A tiny local stand-in for graph.instagram.com: records every call, answers with realistic payloads.
import http from "node:http";

export function startMockGraph(port, { following = true } = {}) {
  const calls = [];
  let n = 0;
  const state = { following };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url, `http://127.0.0.1:${port}`);
      let body = raw;
      try {
        body = raw ? JSON.parse(raw) : null;
      } catch {}
      calls.push({
        method: req.method,
        path: url.pathname,
        query: Object.fromEntries(url.searchParams),
        body,
        auth: req.headers.authorization ?? null,
      });
      const send = (obj, status = 200) => {
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(JSON.stringify(obj));
      };
      const p = url.pathname.replace(/^\/v[\d.]+/, "");
      if (p === "/me") return send({ user_id: "17841400000000001", username: "e2e_shop", account_type: "BUSINESS" });
      if (p.endsWith("/messages")) return send({ recipient_id: "17841499999999991", message_id: `mid.${++n}` });
      if (p.endsWith("/replies")) return send({ id: `reply.${++n}` });
      if (p.endsWith("/subscribed_apps")) return send({ success: true });
      if (url.searchParams.get("fields")?.includes("is_user_follow_business"))
        return send({ name: "Sam Rivera", username: "sam", is_user_follow_business: state.following });
      send({ error: { message: `unmocked ${p}`, code: 100 } }, 400);
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ calls, state, close: () => server.close() })),
  );
}
