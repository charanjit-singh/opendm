// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Rule } from "../../../../src/types/api";
import { Pill } from "../ui/Pill";

interface RulesTableProps {
  rules: Rule[];
  onEdit: (rule: Rule) => void;
  onDelete: (rule: Rule) => void;
}

export function RulesTable({ rules, onEdit, onDelete }: RulesTableProps) {
  if (!rules.length) {
    return (
      <p class="hint" id="rules-list">
        No rules yet. Create one to start replying to comments.
      </p>
    );
  }
  return (
    <div id="rules-list" class="table-scroll">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Keywords</th>
            <th>Channel</th>
            <th>Link</th>
            <th>On</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rules.map((rule) => (
            <tr key={rule.id} data-rule={rule.id}>
              <td>
                <b>{rule.name}</b>
                {rule.media_id && (
                  <>
                    <br />
                    <span class="hint">post {rule.media_id}</span>
                  </>
                )}
              </td>
              <td>
                {rule.keywords.map((keyword) => (
                  <code key={keyword}>{keyword}</code>
                ))}
              </td>
              <td>{rule.channel}</td>
              <td class="table__wrap">{rule.link}</td>
              <td>
                <Pill tone={rule.enabled ? "ok" : undefined}>{rule.enabled ? "on" : "off"}</Pill>
              </td>
              <td class="table__actions">
                <button type="button" class="btn btn--ghost" data-edit={rule.id} onClick={() => onEdit(rule)}>
                  Edit
                </button>{" "}
                <button type="button" class="btn btn--danger" data-del={rule.id} onClick={() => onDelete(rule)}>
                  Delete
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
