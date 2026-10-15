// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// A tiny local stand-in for graph.instagram.com and graph.facebook.com: records every call and answers with realistic payloads.
import http from "node:http";

export const IG_ID = "17841400000000001";
export const PAGE_ID = "112233445566";
export const PAGES = [
  {
    id: PAGE_ID,
    name: "Acme Studio",
    access_token: "EAApagetoken0000000000000000000000",
    instagram_business_account: { id: IG_ID, username: "acme_studio" },
  },
  { id: "998877665544", name: "Acme Labs", access_token: "EAAlabstoken00000000000000000000000" },
];

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
      const fields = url.searchParams.get("fields") ?? "";
      const bearer = req.headers.authorization ?? "";
      if (p === "/me/accounts") {
        // Only a user token (EAAuser...) can list Pages; a Page token cannot.
        return bearer.includes("EAAuser")
          ? send({ data: PAGES })
          : send({ error: { message: "(#100) Page tokens cannot list pages", code: 100 } }, 400);
      }
      if (p === "/me" && fields.includes("instagram_business_account"))
        return send({
          id: PAGE_ID,
          name: "Acme Studio",
          instagram_business_account: PAGES[0].instagram_business_account,
        });
      if (p === "/me") return send({ user_id: IG_ID, username: "acme_studio", account_type: "BUSINESS" });
      if (p === "/oauth/access_token")
        return send({ access_token: "EAAuserlongtoken0000000000000000", expires_in: 5184000 });
      if (p.endsWith("/messages")) return send({ recipient_id: "17841499999999991", message_id: `mid.${++n}` });
      if (p.endsWith("/replies") || p.endsWith("/comments")) return send({ id: `reply.${++n}` });
      if (p.endsWith("/subscribed_apps")) {
        return req.method === "GET"
          ? send({ data: [{ subscribed_fields: ["comments", "messages", "feed"] }] })
          : send({ success: true });
      }
      if (fields.includes("first_name")) return send({ first_name: "Sam", name: "Sam Rivera" });
      if (fields.includes("is_user_follow_business"))
        return send({ name: "Sam Rivera", username: "sam", is_user_follow_business: state.following });
      if (/^\/\d+$/.test(p)) return send({ id: p.slice(1), name: "Acme Studio", username: "acme_studio" });
      send({ error: { message: `unmocked ${p}`, code: 100 } }, 400);
    });
  });
  return new Promise((resolve) =>
    server.listen(port, "127.0.0.1", () => resolve({ calls, state, close: () => server.close() })),
  );
}
