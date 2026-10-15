// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { Flow } from "../../../../src/types/api";
import { Checkbox, SelectField, TextAreaField, TextField } from "../ui/Field";

interface FlowFieldsProps {
  flow: Flow;
  onChange: (flow: Flow) => void;
}

/** The conversation settings of a rule: opener, follow gate, email capture, final message. */
export function FlowFields({ flow, onChange }: FlowFieldsProps) {
  const text = (key: keyof Flow, label: string) => (
    <TextAreaField
      id={`fl-${key}`}
      label={label}
      value={String(flow[key])}
      onInput={(value) => onChange({ ...flow, [key]: value })}
    />
  );
  const number = (key: "followMaxTries" | "followTimeoutMin", label: string, min: number, max: number) => (
    <TextField
      id={`fl-${key}`}
      type="number"
      min={min}
      max={max}
      label={label}
      value={String(flow[key])}
      onInput={(value) => onChange({ ...flow, [key]: Number(value) })}
    />
  );

  return (
    <>
      <h2 class="card__title card__title--section">Conversation</h2>
      <Checkbox id="fl-opener" checked={flow.opener} onChange={(opener) => onChange({ ...flow, opener })}>
        Opener first (private reply asks "want it?", the link follows after they reply)
      </Checkbox>
      {text("openerText", "Opener message")}

      <Checkbox
        id="fl-requireFollow"
        checked={flow.requireFollow}
        onChange={(requireFollow) => onChange({ ...flow, requireFollow })}
      >
        Follow gate
      </Checkbox>
      {text("followText", "Follow request")}
      <details>
        <summary>Follow gate details</summary>
        {text("followRetryText", "Not following yet")}
        <div class="row">
          {number("followMaxTries", "Tries before giving up", 1, 5)}
          <SelectField
            id="fl-followGiveUp"
            label="After the tries"
            value={flow.followGiveUp}
            options={[
              ["send", "Send the link anyway"],
              ["stop", "Stop politely"],
            ]}
            onChange={(followGiveUp) => onChange({ ...flow, followGiveUp: followGiveUp as Flow["followGiveUp"] })}
          />
          {number("followTimeoutMin", "No answer after (minutes)", 2, 600)}
        </div>
        {text("followTimeoutText", "Message when no answer (the link goes out anyway)")}
        {text("followStopText", "Message when stopping")}
      </details>

      <SelectField
        id="fl-askEmail"
        label="Email capture"
        value={flow.askEmail}
        options={[
          ["off", "Off"],
          ["optional", "Ask, they may skip"],
          ["required", "Required before the link"],
        ]}
        onChange={(askEmail) => onChange({ ...flow, askEmail: askEmail as Flow["askEmail"] })}
      />
      <details>
        <summary>Email messages</summary>
        {text("emailText", "Ask")}
        {text("emailRetryText", "Not an email")}
        {text("emailThanks", "Thanks")}
      </details>

      {text("deliverText", "Final message with the link")}
    </>
  );
}
