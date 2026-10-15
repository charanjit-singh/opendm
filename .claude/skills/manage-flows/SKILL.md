---
name: manage-flows
description: Create, change, test and inspect OpenDM keyword flows from plain-English requests, using the opendm MCP tools or CLI. Use when the user describes what should happen when someone comments a keyword, or asks to change, pause, list or debug flows.
---

# Manage OpenDM flows

The user describes the behaviour; you turn it into a rule with the `opendm_*` tools (MCP) or `node cli/opendm.ts`.
Always dry-run before declaring it done.

## Translate the request

| The user says | Rule field |
| --- | --- |
| "whenever someone comments AUTOMATION" | `keywords: ["AUTOMATION"]` |
| "DM them" | default: private reply opener, link after they answer (`openerFirst: true`) |
| "ask them to follow" | `requireFollow: true` (and `followText` to customise) |
| "then send the link" / "send <url>" | `link: "<url>"` |
| "send the link right away", "no follow" | `openerFirst: false`, `requireFollow: false` |
| "collect their email" | `askEmail: "optional"` or `"required"` |
| "if they ignore the follow ask, send it anyway after 30 minutes" | `followTimeoutMinutes: 30` |
| "only on this post" | `mediaId: "<media or post id>"` |
| "on Facebook too" / "just Facebook" | `channel: "both"` / `"facebook"` |
| "also when they DM me the word" | `dmTrigger: true` |
| "use different wordings", "rotate the message" | `messages: {openerText: [..], deliverText: [..]}`, `rotation` (`opendm_set_messages`) |
| "reply to the comment with 'Sent you a DM!'" | `publicReplies: ["Sent you a DM!"]` |
| custom wording | `openerText`, `followText`, `emailText`, `finalMessage` |

Placeholders in any message: `{name}` (first name, dropped cleanly when unknown), `{keyword}`, `{link}`, `{account}`.
`finalMessage` should contain `{link}`.

Ask only for what is missing and unguessable (usually the link). Do not invent URLs.

## Procedure

1. `opendm_status`: is the account connected and automation on? If not, say so; flows can still be created.
2. `opendm_list_rules`: look for an existing rule with the same keyword. Update it (`opendm_update_rule`) instead of creating a
   duplicate.
3. `opendm_create_rule` or `opendm_update_rule` (update changes only the fields you pass).
4. `opendm_test_comment` with a realistic comment and the replies a person would give, e.g.
   `comment: "AUTOMATION please", replies: ["yes", "done"], following: "yes"`. Also test the unhappy path when a follow gate
   exists: `following: "no"`, and `waitMinutes` beyond the timeout. Show the user the transcript.
5. Summarise in two or three lines what the flow does. Mention that non-followers receive the DM in message requests.

Other requests: `opendm_list_leads` (emails), `opendm_list_conversations`, `opendm_set_enabled` (global switch), `opendm_delete_rule` (confirm first), `opendm_get_log` (what
happened to a comment), `opendm_set_hourly_limit`.

## Limits to keep in mind

- One private reply per comment, within 7 days. The link follows after the person replies (that opens the 24 hour window).
- Meta may not report follow status; the flow then trusts "done". Say so if the user needs a hard guarantee (it can't be
  given).
- Typos in keywords match only for short comments and only when `allowTypos` is on (default).
