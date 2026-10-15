---
description: Deploy OpenDM to the user's Cloudflare account and set the secrets
---

Deploy OpenDM following `.claude/skills/deploy-opendm/SKILL.md`, sections 1 to 3 (prerequisites, deploy, secrets).

- Check `npx wrangler whoami`; if not logged in, ask the user to run `! npx wrangler login`.
- Ask for the Worker name (default `opendm`), then `npx wrangler deploy`.
- Generate `ADMIN_PASSWORD`, `SESSION_SECRET`, `VERIFY_TOKEN` yourself and pipe them into `wrangler secret put`. Never print them except the admin password once, for the user to save.
- Verify `GET /health`, then continue with `/onboard` for the Meta app, connecting and the webhook.

$ARGUMENTS
