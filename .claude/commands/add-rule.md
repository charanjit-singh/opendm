---
description: Create or change a keyword flow from a plain-English description
---

Follow `.claude/skills/manage-flows/SKILL.md`. The user's description: $ARGUMENTS

Use `opendm_create_rule` / `opendm_update_rule` / `opendm_set_messages` (several wordings per message, cycled), then `opendm_test_comment` with realistic replies, and show the transcript before finishing. Use `channel: "both"` for Instagram and Facebook, and `dmTrigger: true` to also start on keyword DMs.
