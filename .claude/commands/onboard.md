---
description: Take the user from zero to live (deploy, Meta app, connect, webhook, first rule)
---

Run the onboarding playbook in `docs/ai-agents.md` (also summarised in `AGENTS.md`), end to end:

1. Deploy (`/deploy`) if no Worker exists yet.
2. Export `OPENDM_URL` and `OPENDM_TOKEN`, then call `opendm_setup_status` (MCP) or `node cli/opendm.ts setup status --json` and follow its `next` step. Re-run after every step.
3. For steps marked `needsHuman` (creating the Meta app, logging in, authorizing OAuth, commenting from a second account) tell the user exactly what to do, wait, and re-check. You may drive the browser if the user has a browser tool connected and is logged in.
4. Finish with `opendm_send_test`, create the first rule with the `manage-flows` skill, and ask the user to comment the keyword from a tester account.

Never print secrets. Confirm before destructive changes. $ARGUMENTS
