---
name: deploy-opendm
description: Deploy OpenDM to the user's Cloudflare account and connect their Instagram account. Use when asked to deploy, install, host or set up OpenDM, or to connect Instagram to it.
---

# Deploy OpenDM and connect Instagram

Work through these steps in order, telling the user briefly what you are doing. Stop and ask when a step needs them
(logging in, creating the Meta app, pasting a token).

## 1. Prerequisites

```sh
node -v                  # needs >= 22.18
npm install
npx wrangler whoami      # must show the Cloudflare account to deploy to
```

If `whoami` says not logged in, ask the user to run `! npx wrangler login` in this session (a browser step). If they
have several accounts, ask which one and set `CLOUDFLARE_ACCOUNT_ID`.

Ask what to call the Worker (default `opendm`). To rename it, edit `name` (and `database_name`) in `wrangler.jsonc`.

## 2. Deploy

```sh
npx wrangler deploy
```

This builds the dashboard (`npm run build:web`), uploads the Worker and static assets, and **creates the D1 database
automatically** (the schema is applied on the first request). Note the URL it prints: `https://<name>.<subdomain>.workers.dev`.

## 3. Secrets

Generate three of them yourself, never echo them into the chat except the admin password at the end:

```sh
ADMIN_PASSWORD=$(openssl rand -base64 18 | tr -d '/+=')
printf '%s' "$ADMIN_PASSWORD"            | npx wrangler secret put ADMIN_PASSWORD
openssl rand -hex 32 | tr -d '\n'        | npx wrangler secret put SESSION_SECRET
openssl rand -hex 16 | tr -d '\n'        | npx wrangler secret put VERIFY_TOKEN
```

`INSTAGRAM_APP_SECRET` comes from the user's Meta app (step 4). Until then put a placeholder so the Worker starts, and
replace it later: `printf 'placeholder' | npx wrangler secret put INSTAGRAM_APP_SECRET`.

Tell the user their admin password once and ask them to save it in a password manager. Also remember the `VERIFY_TOKEN`
value (read it back from your own variable, not from Cloudflare: secrets can't be read).

Check: `curl -s https://<url>/health` returns `{"ok":true,...}`.

## 4. Meta app checklist (the user does this in the browser; guide them)

Instagram **Professional** account required (Business or Creator).

1. <https://developers.facebook.com/apps> > **Create app** > use case *Other* > type *Business*.
2. Add the **Instagram** product > **API setup with Instagram login**.
3. Copy the **Instagram app secret**. Then you run:
   `printf '%s' '<secret>' | npx wrangler secret put INSTAGRAM_APP_SECRET` (ask them to paste it to you; don't log it).
4. **Add account**: add their Instagram account (they accept the tester invite in Instagram: Settings > Apps and
   websites > Tester invites).
5. **Generate token** for the account with permissions `instagram_business_basic`,
   `instagram_business_manage_comments`, `instagram_business_manage_messages`.
6. **Configure webhooks**: callback URL `https://<url>/webhook`, verify token = the `VERIFY_TOKEN` you generated.
   Subscribe to `comments` and `messages`.
7. Optional OAuth button: set `INSTAGRAM_APP_ID` (`npx wrangler secret put INSTAGRAM_APP_ID`) and add
   `https://<url>/admin/oauth/callback` to the redirect URIs.

Development mode is enough for the user's own account. Serving the public needs App Review (Advanced Access for the three
permissions) and Business Verification: tell them, and point to the README section "Going live".

## 5. Connect and verify

Set the environment for the CLI/MCP tools (the token is the admin password):

```sh
export OPENDM_URL=https://<url>
export OPENDM_TOKEN=<admin password>
```

Then, with the MCP tools (or `node cli/opendm.ts ...`):

1. `opendm_connect_instagram` with the token from step 4.5 (or the user uses the dashboard / OAuth button).
2. `opendm_subscribe_webhooks`.
3. `opendm_status` should show the account connected.
4. Create a first flow with the `manage-flows` skill and dry-run it with `opendm_test_comment`.
5. Ask the user to comment the keyword from a second Instagram account that has a role on the Meta app.

To make the MCP tools available in Claude Code, the repo's `.mcp.json` already registers them; the user must export
`OPENDM_URL` and `OPENDM_TOKEN` in the shell that starts Claude Code, then restart it (or run
`claude mcp add opendm -e OPENDM_URL=... -e OPENDM_TOKEN=... -- node cli/mcp.ts`).

## Troubleshooting

- Webhook verification fails in Meta: the verify token differs from the `VERIFY_TOKEN` secret. Set it again and retry.
- Comments arrive but nothing is sent: `opendm_get_log` shows why (no keyword matched, automation off, token error,
  over the hourly cap, "message requests").
- 401 from the tools: `OPENDM_TOKEN` is not the current `ADMIN_PASSWORD`.
