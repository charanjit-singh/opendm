# Security policy

## Reporting a vulnerability

Please do not open a public issue for security problems. Report them privately through GitHub:
**Security tab > Report a vulnerability** on <https://github.com/charanjit-singh/opendm>.

Include what you found, how to reproduce it, and the impact you see. We aim to acknowledge reports within a few days and
to publish a fix and an advisory once users have had time to update.

## Supported versions

Only the latest release on `main` receives security fixes.

## What the project does to protect you

- Webhooks are accepted only with a valid `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with your Instagram app
  secret, compared in constant time).
- The dashboard needs the admin password; the session cookie is HttpOnly and SameSite=Strict, writes must be JSON, and
  failed logins lock an address out for 15 minutes after 10 attempts.
- Instagram access tokens are encrypted (AES-GCM) in D1, are never returned by the API and are scrubbed from logs.

## Hardening your deployment

- Use a long random `ADMIN_PASSWORD` and `SESSION_SECRET`. Rotate them with `wrangler secret put`.
- Keep the Meta app in development mode until you need public access.
- Consider putting `/admin` behind [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/policies/access/) for extra protection.
- Treat `OPENDM_TOKEN` (the admin password) used by the CLI and MCP server like any other credential.
