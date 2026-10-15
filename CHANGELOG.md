# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.0]

### Added
- Facebook Pages and Messenger as a second channel: Page comment triggers, Messenger private replies, public comment replies,
  keyword direct messages, and Instagram through Facebook Login (Page token). Per-rule channel (Instagram, Facebook, both).
- Message cycling: several wordings for every message and for public replies, round-robin or random, with the wording used
  recorded in the log.
- Setup wizard in the dashboard with live checks; OAuth for Instagram Login and Facebook Login (with Page selection);
  app credentials stored encrypted in D1; token exchange and refresh.
- Remote MCP server on the Worker (`/mcp`, Streamable HTTP) with 29 tools; stdio fallback; agent-friendly CLI (`--json`,
  exit codes, `opendm setup`).
- `AGENTS.md`, `llms.txt`, Claude Code commands, and docs: onboarding, Facebook, message cycling, custom domain, AI agents.
- Migration 0002 (applied automatically; upgrades existing databases).

### Changed
- `INSTAGRAM_APP_SECRET` is no longer a required Worker secret; enter the app credentials in the Setup tab.

## [0.1.0]

### Added
- Instagram webhook endpoint with verify-token handshake and `X-Hub-Signature-256` verification.
- Keyword rules (typo tolerant, optional per-post) that send a private reply and a rotating public comment reply.
- DM flow: opener, follow gate (API check, "tap done" fallback, timeout fallback), optional email capture, link.
- Rolling hourly send cap with a D1 outbox, retries with backoff, webhook dedupe and an event log.
- Admin dashboard (Vite + Preact + TypeScript, served by Workers Static Assets): connect account by token or OAuth,
  rule and message editor, dry-run tester, log, on/off switch.
- `opendm` CLI and an MCP server so Claude can set up and manage flows in plain English.
- Instagram token encryption at rest and automatic refresh.
- Hono backend with zod-validated admin API; D1 schema applied automatically on first request.
- Unit and integration tests in the Workers runtime, an end-to-end test against `wrangler dev`, and a Playwright browser test.
