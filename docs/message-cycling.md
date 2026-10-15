# Message cycling

Sending the same text to everyone can look like spam to Instagram and Facebook's filters. Every message OpenDM sends can have
**several wordings**, and OpenDM cycles through them.

## What can cycle

Public comment replies, the opener, the follow ask, the "not following yet" retry, the follow-timeout text, the email ask,
the thanks, the stop messages and the final link message. Placeholders (`{name}`, `{keyword}`, `{link}`, `{account}`) work in
every wording.

## How it picks

Per rule you choose the rotation:

- **Take turns, in order** (`round_robin`, default): wording 1, 2, 3, 1, ... The counter is kept in D1 per rule and message, so
  it survives restarts and is shared across all conversations.
- **Pick one at random** (`random`).

## Setting it up

**Dashboard:** in a rule, under each message press **Add a wording**. The first wording is the main one; remove extras with
**Remove**. Public replies are one per line. The **Test** tab previews all wordings (it cycles in the dry run, or enter
**Preview wording #** to see one).

**CLI:**

```sh
node cli/opendm.ts rule messages 3 --messages '{"openerText":["Hey {name}! Want the guide?","Hi {name}, want it?"],"deliverText":["Here: {link}","Yours: {link}"]}' --rotation random
```

**MCP:** `opendm_set_messages` (rule id, `messages`, `rotation`, `publicReplies`), or the same fields on `opendm_create_rule`
and `opendm_update_rule`.

**API:** `flow.variants` is an object of message key to a list of wordings; `flow.rotation` is `round_robin` or `random`.

## Seeing what was sent

The event log has a **Wording** column such as `openerText#2/3` (the second of three), `public#1/2` for public replies. The
CLI log and `opendm_get_log` show it in brackets.

## Tips

- Vary meaning-preserving details (greeting, punctuation, emoji), not the offer.
- Three to five wordings of the opener and the public reply are plenty.
- A wording must still make sense after the previous message, because the person sees the whole thread.
