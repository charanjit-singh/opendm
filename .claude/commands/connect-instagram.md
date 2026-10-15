---
description: Connect Instagram (and optionally a Facebook Page) to a deployed OpenDM
---

Connect the accounts using `docs/onboarding.md`.

1. `opendm_setup_status` to see which step is next.
2. App credentials: ask the user for the Meta App ID and secret, then `opendm_set_app_credentials` (platform `instagram`, and `facebook` if Pages are wanted). Do not echo the secret back.
3. Connect: `opendm_get_oauth_url` and ask the user to open the URL in the browser where they are logged in to the dashboard; or take a token they paste and call `opendm_exchange_token` (Instagram) / `opendm_connect_facebook` then `opendm_select_facebook_page`.
4. `opendm_get_webhook_details`, have the user paste the callback URL and verify token into the Meta app, then `opendm_subscribe_webhooks` for each platform.
5. `opendm_setup_checks` must show every check ok except "webhook events" until a comment arrives.

$ARGUMENTS
