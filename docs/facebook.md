# Facebook Pages and Messenger

OpenDM treats Facebook as a second channel next to Instagram. A rule chooses **Instagram**, **Facebook Page** or **both**.

## What it does

- **Page comments:** a comment with the keyword on a Page post gets a **private reply** through Messenger (the Private Replies
  API: `POST /{page-id}/messages` with `recipient.comment_id`) and an optional **public comment reply** (`POST
  /{comment-id}/comments`).
- **Messenger:** the person's answer continues the same flow: opener, a "like our Page" ask, optional email, link.
- **Keyword DMs:** with the rule's *also start on keyword DMs* option, a Messenger (or Instagram) message that contains the
  keyword starts the flow. The person already opened the 24 hour window, so the opener is skipped.
- Message cycling, rate limits, queue, log and dry-run work exactly as on Instagram. The log shows the platform.

## Differences from Instagram

| | Instagram | Facebook |
| --- | --- | --- |
| Follow gate | asks to follow; checks `is_user_follow_business` when Meta allows it | asks to **like the Page**; Facebook offers no check, so OpenDM trusts "done" and the timeout still sends the link |
| Public reply endpoint | `/{comment-id}/replies` | `/{comment-id}/comments` |
| Threads | replies have `parent_id` | a top-level comment has `parent_id` = the post id; anything else is a reply and is ignored |
| Hidden commenters | n/a | Meta sometimes omits who commented until App Review. Then the private reply carries the link itself (no opener, no gates) |
| Messaging window | 24 h after their reply | 24 h after their reply (Messenger standard messaging) |

## Connecting

1. Meta app: add **Messenger** and **Facebook Login**; save the App ID and secret in OpenDM's Setup tab (platform Facebook).
2. Setup, step 3: **Connect with Facebook** (OAuth). Choose the Page if asked. Or paste a Page access token or a user token.
3. Webhooks: object **Page**, callback `https://<your-worker>/webhook`, your verify token, fields `feed`, `messages`,
   `messaging_postbacks`. Press **Subscribe facebook** (this calls `POST /{page-id}/subscribed_apps`).

Permissions: `pages_show_list`, `pages_manage_metadata`, `pages_messaging`, `pages_read_engagement`,
`pages_manage_engagement`. Page tokens obtained from a long-lived user token do not expire.

## Instagram through Facebook Login

If your Instagram professional account is linked to the Page, OpenDM also detects it (`instagram_business_account`) and can send
Instagram messages with the **Page token** (`/{page-id}/messages`). It is used only when no Instagram Login token is
connected; an Instagram Login connection always wins. Use this path if you already run Facebook Login, or if you need
features only available through the Page. Extra permissions: `instagram_basic`, `instagram_manage_comments`,
`instagram_manage_messages`. Subscribe the Page, and in the Meta app's Webhooks add the **Instagram** object too.

## App Review

People with a role on the app work right away. For everyone else you need Advanced Access for `pages_messaging` (and
`pages_read_engagement` to see their comments) once the app is Live. If strangers' comments never show up in the log, that is
usually the reason.

## From the CLI and MCP

```sh
node cli/opendm.ts setup facebook --token <user or Page token> [--page-id <id>]
node cli/opendm.ts rule add --keywords AUTOMATION --link https://example.com/g --channel both --dm-trigger
node cli/opendm.ts test "AUTOMATION" --platform facebook
```

MCP: `opendm_connect_facebook`, `opendm_list_facebook_pages`, `opendm_select_facebook_page`, `opendm_subscribe_webhooks`
(platform `facebook`), and `channel` / `dmTrigger` on `opendm_create_rule`.
