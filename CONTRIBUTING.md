# Contributing to OpenDM

Thanks for helping. OpenDM is maintained by [SS Enterprises](https://vibemastery.io) and licensed under AGPL-3.0-or-later;
by contributing you agree your changes are released under the same license.

## Setup

```sh
git clone https://github.com/charanjit-singh/opendm && cd opendm
npm install
cp .dev.vars.example .dev.vars
npm run dev              # Worker + dashboard on http://localhost:8787
npm run dev:web          # optional: Vite dev server with hot reload, proxying /api to :8787
```

Node 22.18 or newer is needed (the CLI and MCP server run TypeScript directly).

## Before you open a pull request

```sh
npm run format           # Biome: formats and fixes lint
npm run lint
npm run typecheck
npm test                 # unit + integration, in the Workers runtime
npm run test:e2e         # wrangler dev + mock Graph API (slower)
npm run test:browser     # Playwright + Chrome; needs Google Chrome installed
```

CI runs all of these. Please add or update tests with your change; behaviour without a test is hard to keep.

## Code style

- TypeScript, strict. No `any` in `src/`.
- Biome decides formatting (2 spaces, double quotes, 120 columns). Don't hand-format.
- Small, focused functions; one concern per module (`routes/`, `services/`, `db/`, `lib/`).
- Validate every admin API body with zod (`src/routes/schemas.ts`).
- `src/services/flow.ts` stays free of I/O.
- Every outgoing Graph call goes through `src/services/send-queue.ts`.
- Comments say why, not what. Keep them short.
- New files start with the header: `// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.`

## Commits and pull requests

- Logical commits with clear messages. One topic per pull request.
- Describe what changed and how you tested it. Screenshots help for dashboard changes (`npm run test:browser` refreshes `docs/*.png`).
- Never include real tokens, Instagram data or personal information in issues, tests or screenshots.

## Reporting bugs and ideas

Use the issue templates. For security problems follow [SECURITY.md](SECURITY.md) and do not open a public issue.
