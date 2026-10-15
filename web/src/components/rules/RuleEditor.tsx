// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { useState } from "preact/hooks";
import type { Flow, Rule } from "../../../../src/types/api";
import { api, type RuleInput } from "../../api";
import { errorMessage } from "../../lib/format";
import { Card } from "../ui/Card";
import { Checkbox, TextAreaField, TextField } from "../ui/Field";
import { Notice } from "../ui/Notice";
import { FlowFields } from "./FlowFields";

interface RuleEditorProps {
  rule: Rule | null;
  defaults: Flow;
  onCancel: () => void;
  onSaved: () => void;
}

interface RuleForm {
  name: string;
  keywords: string;
  link: string;
  mediaId: string;
  replies: string;
  fuzzy: boolean;
  enabled: boolean;
  flow: Flow;
}

const toForm = (rule: Rule | null, defaults: Flow): RuleForm => ({
  name: rule?.name ?? "",
  keywords: rule?.keywords.join(", ") ?? "",
  link: rule?.link ?? "",
  mediaId: rule?.media_id ?? "",
  replies: rule?.public_replies.join("\n") ?? "",
  fuzzy: rule?.fuzzy ?? true,
  enabled: rule?.enabled ?? true,
  flow: rule?.flow ?? defaults,
});

const toInput = (form: RuleForm): RuleInput => ({
  name: form.name,
  keywords: form.keywords.split(","),
  link: form.link,
  media_id: form.mediaId || null,
  public_replies: form.replies.split("\n"),
  fuzzy: form.fuzzy,
  enabled: form.enabled,
  flow: { ...form.flow },
});

export function RuleEditor({ rule, defaults, onCancel, onSaved }: RuleEditorProps) {
  const [form, setForm] = useState(() => toForm(rule, defaults));
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof RuleForm>(key: K) => (value: RuleForm[K]) => setForm((f) => ({ ...f, [key]: value }));

  const save = async () => {
    setError(null);
    try {
      const input = toInput(form);
      await (rule ? api.updateRule(rule.id, input) : api.createRule(input));
      onSaved();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <Card id="editor">
      <h2 class="card__title" id="editor-title">
        {rule ? "Edit rule" : "New rule"}
      </h2>
      <div class="row">
        <TextField id="f-name" label="Name" placeholder="Free guide" value={form.name} onInput={set("name")} />
        <TextField id="f-keywords" label="Keywords (comma separated)" placeholder="GUIDE, LINK" value={form.keywords} onInput={set("keywords")} />
      </div>
      <div class="row">
        <TextField id="f-link" label="Link to send ({link})" placeholder="https://example.com/guide" value={form.link} onInput={set("link")} />
        <TextField id="f-media" label="Only on this post (media ID, optional)" placeholder="all posts" value={form.mediaId} onInput={set("mediaId")} />
      </div>
      <TextAreaField
        id="f-replies"
        label="Public comment replies (one per line, rotated; leave empty for the defaults)"
        placeholder="Sent you a DM!"
        value={form.replies}
        onInput={set("replies")}
      />
      <div class="row">
        <Checkbox id="f-fuzzy" checked={form.fuzzy} onChange={set("fuzzy")}>
          Allow small typos in the keyword
        </Checkbox>
        <Checkbox id="f-enabled" checked={form.enabled} onChange={set("enabled")}>
          Rule enabled
        </Checkbox>
      </div>
      <p class="hint">
        Placeholders: <code>{"{name}"}</code> <code>{"{keyword}"}</code> <code>{"{link}"}</code> <code>{"{account}"}</code>
      </p>
      <FlowFields flow={form.flow} onChange={set("flow")} />
      {error && <Notice kind="error" id="editor-err">{error}</Notice>}
      <p>
        <button type="button" class="btn" id="save-rule" onClick={save}>
          Save rule
        </button>{" "}
        <button type="button" class="btn btn--ghost" id="cancel-rule" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </Card>
  );
}
