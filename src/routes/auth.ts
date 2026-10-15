// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { makeToken } from "../lib/crypto";
import { clientIp, SESSION_COOKIE, SESSION_TTL_SECONDS } from "../lib/http";
import { parseBody } from "../lib/validate";
import { checkAdminPassword } from "../services/admin-auth";
import type { AppEnv } from "../types/app";
import { loginSchema } from "./schemas";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/login", async (c) => {
  const { password } = await parseBody(c, loginSchema);
  const check = await checkAdminPassword(c.env, clientIp(c), password);
  if (!check.ok) return c.json({ error: check.error }, check.status);
  const token = await makeToken(c.env.SESSION_SECRET, "admin", SESSION_TTL_SECONDS);
  setCookie(c, SESSION_COOKIE, token, {
    path: "/",
    httpOnly: true,
    sameSite: "Strict",
    maxAge: SESSION_TTL_SECONDS,
    secure: new URL(c.req.url).protocol === "https:",
  });
  return c.json({ ok: true });
});

authRoutes.post("/logout", (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});
