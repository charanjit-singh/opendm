// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { Field } from "./Field";

interface VariantsProps {
  /** The id of the first textarea; later ones get a numeric suffix. */
  id: string;
  label: string;
  /** All wordings. Always at least one. */
  values: string[];
  onChange: (values: string[]) => void;
}

/** One message with any number of alternative wordings. They are cycled on every send. */
export function Variants({ id, label, values, onChange }: VariantsProps) {
  const setAt = (index: number, text: string) => onChange(values.map((v, i) => (i === index ? text : v)));
  return (
    <Field id={id} label={values.length > 1 ? `${label} (${values.length} wordings, cycled)` : label}>
      {values.map((text, index) => (
        <div class="variants__item" key={index}>
          <textarea
            class="textarea"
            id={index === 0 ? id : `${id}-${index + 1}`}
            value={text}
            onInput={(e) => setAt(index, e.currentTarget.value)}
          />
          {values.length > 1 && (
            <button
              type="button"
              class="btn btn--ghost btn--small"
              aria-label="Remove this wording"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          )}
        </div>
      ))}
      <button
        type="button"
        class="btn btn--ghost btn--small"
        id={`${id}-add`}
        onClick={() => onChange([...values, values[0] ?? ""])}
      >
        Add a wording
      </button>
    </Field>
  );
}
