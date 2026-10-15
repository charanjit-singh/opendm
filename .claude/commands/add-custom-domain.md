---
description: Put OpenDM on a custom domain and update Meta's callback and redirect URLs
---

Follow `docs/custom-domain.md`.

1. Ask for the domain (it must be a zone in the user's Cloudflare account) and the hostname, e.g. `dm.example.com`.
2. Add a custom domain route to `wrangler.jsonc` (`"routes": [{ "pattern": "dm.example.com", "custom_domain": true }]`) and run `npx wrangler deploy`.
3. Verify `https://dm.example.com/health`.
4. Tell the user to update the Meta app: webhook callback URL `https://dm.example.com/webhook` (re-verify with the same verify token), and the OAuth redirect URI `https://dm.example.com/admin/oauth/callback` for Instagram Login and Facebook Login. Then run `opendm_subscribe_webhooks` and `opendm_setup_checks`.
5. Update `OPENDM_URL` for the CLI and MCP server.

$ARGUMENTS
