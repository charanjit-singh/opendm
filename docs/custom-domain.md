# Custom domain

By default OpenDM lives at `https://<name>.<your-subdomain>.workers.dev`. To use your own hostname such as
`dm.example.com`:

## Requirements

The domain's DNS zone must be on Cloudflare in the same account as the Worker.

## Option A: Custom Domain (recommended)

Cloudflare creates the DNS record and certificate for you.

1. **Dashboard:** Workers & Pages, your Worker, **Settings**, **Domains & Routes**, **Add**, **Custom Domain**, enter
   `dm.example.com`.
2. **Or in `wrangler.jsonc`:**

   ```jsonc
   {
     "routes": [{ "pattern": "dm.example.com", "custom_domain": true }]
   }
   ```

   then `npx wrangler deploy`.

## Option B: a route on an existing hostname

Use this if the hostname already has DNS and proxied traffic.

```jsonc
{
  "routes": [{ "pattern": "example.com/opendm/*", "zone_name": "example.com" }]
}
```

Custom Domains are simpler; routes with a path prefix need the app to be served from `/`, so prefer a dedicated hostname.

## Update Meta

After the domain works, update the Meta app (otherwise webhooks and OAuth still point at the old URL):

1. **Webhooks:** Callback URL `https://dm.example.com/webhook` with the same verify token. Re-verify and save, for the
   Instagram object and the Page object.
2. **OAuth redirect URIs:** add `https://dm.example.com/admin/oauth/callback` under Instagram **Business login settings** and
   Facebook Login **Valid OAuth Redirect URIs**.
3. **Privacy policy URL** (App settings, Basic): `https://dm.example.com/privacy`.
4. In OpenDM press **Subscribe** again (Setup, step 5) and **Run live checks**.
5. Point the CLI and MCP server at the new host: `export OPENDM_URL=https://dm.example.com`.

## Verify

```sh
curl https://dm.example.com/health          # {"ok":true,"name":"opendm",...}
curl "https://dm.example.com/webhook?hub.mode=subscribe&hub.verify_token=<VERIFY_TOKEN>&hub.challenge=123"   # 123
```

The old `workers.dev` URL keeps working unless you disable it with `"workers_dev": false` in `wrangler.jsonc`. Keep it on until
Meta is switched over.

## Cloudflare Access (optional)

To protect the dashboard, add a Cloudflare Access application for `dm.example.com/` but **bypass** `/webhook`, `/api/*`,
`/mcp` and `/health` (Meta and your tools must reach them; they have their own authentication).
