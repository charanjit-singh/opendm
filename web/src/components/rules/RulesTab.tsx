// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useEffect, useState } from "preact/hooks";
import type { Rule, Status } from "../../../../src/types/api";
import { api } from "../../api";
import { errorMessage } from "../../lib/format";
import type { TabProps } from "../tab-props";
import { Card } from "../ui/Card";
import { RuleEditor } from "./RuleEditor";
import { RulesTable } from "./RulesTable";

/** `null` means closed, `"new"` a blank form, a Rule an edit. */
type Editing = Rule | "new" | null;

export function RulesTab({ status, refresh, notify }: TabProps & { status: Status }) {
  const [rules, setRules] = useState<Rule[]>([]);
  const [editing, setEditing] = useState<Editing>(null);

  const load = () =>
    api
      .listRules()
      .then((d) => setRules(d.rules))
      .catch((e) => notify(errorMessage(e), "error"));
  useEffect(() => void load(), []);

  const remove = async (rule: Rule) => {
    if (!confirm("Delete this rule?")) return;
    await api.deleteRule(rule.id);
    await load();
    await refresh();
  };

  return (
    <section>
      <Card>
        <div class="row row--center">
          <h2 class="card__title card__title--flush">Keyword rules</h2>
          <div class="align-right">
            <button type="button" class="btn" id="new-rule" onClick={() => setEditing("new")}>
              New rule
            </button>
          </div>
        </div>
        <RulesTable rules={rules} onEdit={setEditing} onDelete={remove} />
      </Card>
      {editing && (
        <RuleEditor
          key={editing === "new" ? "new" : editing.id}
          rule={editing === "new" ? null : editing}
          defaults={status.defaults.flow}
          facebookDefaults={status.defaults.facebookFlow}
          onCancel={() => setEditing(null)}
          onSaved={async () => {
            setEditing(null);
            notify("Rule saved");
            await load();
            await refresh();
          }}
        />
      )}
    </section>
  );
}
