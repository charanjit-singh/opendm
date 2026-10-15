# OpenDM: guide for Claude Code

OpenDM is an open-source, self-hosted Instagram comment-to-DM automation on Cloudflare Workers (Hono + D1 backend,
Preact dashboard served as static assets). Copyright (C) 2026 SS Enterprises, AGPL-3.0.

Two jobs people ask you to do here:

1. **Deploy and set it up** on their Cloudflare account: follow `.claude/skills/deploy-opendm/SKILL.md`.
2. **Set up and change flows in plain English** ("whenever someone comments AUTOMATION, DM them, ask them to follow,
   then send the link"): follow `.claude/skills/manage-flows/SKILL.md`. Use the `opendm_*` MCP tools (see `.mcp.json`),
   or the `opendm` CLI (`node cli/opendm.ts help`) when MCP is not connected.

## Ground rules

- Never print or commit secrets: `ADMIN_PASSWORD`, `SESSION_SECRET`, `INSTAGRAM_APP_SECRET`, Instagram tokens.
  Generate secrets with `openssl rand -hex 32` and pipe them straight into `wrangler secret put`.
- Do not send real DMs while testing. Use `opendm_test_comment` (a dry run) first; only connect a real account when the
  user asks.
- Ask before deleting rules, disconnecting the account, or switching automation off for everyone.
- Meta's rules apply: only message people who commented or messaged the account; don't promise anything the flow
  doesn't do.

## Repository map

| Path | What |
| --- | --- |
| `src/index.ts` | Hono app and cron entry |
| `src/routes/` | `webhook.ts`, `auth.ts`, `oauth.ts`, `admin/` (rules, account, status) |
| `src/services/` | `flow.ts` (the conversation state machine), `matching.ts`, `graph.ts` (Instagram API client), `send-queue.ts` (rate limit + outbox), `webhook-processor.ts`, `dry-run.ts`, cron jobs |
| `src/db/` | D1 access and the schema (`migrations/0001_init.sql` is the source) |
| `web/` | Dashboard (Vite + Preact + TypeScript), built to `dist/client` |
| `cli/` | `opendm` CLI and the MCP server (`mcp.ts`), both on one tool registry (`tools.ts`) |
| `test/` | Vitest in the Workers runtime; `e2e/` runs wrangler dev + a mock Graph API; `e2e/browser.mjs` drives Chrome |

## Commands

```sh
npm install
npm run dev          # wrangler dev (builds the dashboard first)
npm run dev:web      # Vite dev server for the dashboard, proxying /api to wrangler dev on :8787
npm run lint         # Biome (format + lint). `npm run format` fixes.
npm run typecheck
npm test             # unit + integration tests (workerd)
npm run test:e2e     # wrangler dev + mock Graph API + CLI + MCP over stdio
npm run test:browser # Playwright + Chrome, writes docs/*.png
npm run test:all
```

## Conventions

- TypeScript strict, no `any` in `src/`. Validate every admin API body with zod (`src/routes/schemas.ts`).
- Keep `src/services/flow.ts` free of I/O: it is shared by live DMs and the dashboard dry run.
- Every outgoing Graph call goes through `src/services/send-queue.ts`.
- New behaviour comes with a test next to the existing ones. Run `npm run lint && npm run typecheck && npm test`.
- File header: `// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.`
- Don't write claims about how the code was authored in docs or README.
