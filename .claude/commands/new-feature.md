---
description: Add a feature to OpenDM's code (fork workflow)
---

Add this feature to the repository: $ARGUMENTS

1. Read `CLAUDE.md` (architecture map, conventions). Find where the change belongs: a service in `src/services/`, a route in `src/routes/`, a table change as a new `migrations/000N_*.sql` file registered in `src/db/schema.ts`, UI in `web/src/components/`, a tool in `src/mcp/tools.ts`.
2. Keep `src/services/flow.ts` free of I/O and route every Graph call through `src/services/send-queue.ts`.
3. Validate new admin inputs with zod in `src/routes/schemas.ts`; expose the capability to Claude by adding an MCP tool (and a CLI command if useful).
4. Add tests next to the existing ones (`test/`), then run `npm run lint && npm run typecheck && npm test`. Run `npm run test:e2e` and `npm run test:browser` when you touched webhooks or the dashboard.
5. Update the README or docs and `CHANGELOG.md`, then deploy with `npx wrangler deploy` if the user wants it live.
