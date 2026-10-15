// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { ComponentChildren } from "preact";

interface FieldProps {
  id: string;
  label: string;
  children: ComponentChildren;
}

/** A label above a control. The control gets the same `id`. */
export function Field({ id, label, children }: FieldProps) {
  return (
    <div class="field">
      <label class="field__label" for={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

interface TextFieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
  type?: "text" | "password" | "number";
  min?: number;
  max?: number;
}

export function TextField({ id, label, value, onInput, type = "text", ...rest }: TextFieldProps) {
  return (
    <Field id={id} label={label}>
      <input class="input" id={id} type={type as "text"} value={value} onInput={(e) => onInput(e.currentTarget.value)} {...rest} />
    </Field>
  );
}

interface TextAreaFieldProps {
  id: string;
  label: string;
  value: string;
  onInput: (value: string) => void;
  placeholder?: string;
}

export function TextAreaField({ id, label, value, onInput, placeholder }: TextAreaFieldProps) {
  return (
    <Field id={id} label={label}>
      <textarea class="textarea" id={id} value={value} placeholder={placeholder} onInput={(e) => onInput(e.currentTarget.value)} />
    </Field>
  );
}

interface SelectFieldProps {
  id: string;
  label: string;
  value: string;
  options: [value: string, label: string][];
  onChange: (value: string) => void;
}

export function SelectField({ id, label, value, options, onChange }: SelectFieldProps) {
  return (
    <Field id={id} label={label}>
      <select class="select" id={id} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
        {options.map(([optionValue, text]) => (
          <option key={optionValue} value={optionValue}>
            {text}
          </option>
        ))}
      </select>
    </Field>
  );
}

interface CheckboxProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ComponentChildren;
}

export function Checkbox({ id, checked, onChange, children }: CheckboxProps) {
  return (
    <label class="check">
      <input type="checkbox" id={id} checked={checked} onChange={(e) => onChange(e.currentTarget.checked)} />
      {children}
    </label>
  );
}
