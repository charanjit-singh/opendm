// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
interface PillProps {
  tone?: "ok" | "warn" | "error";
  id?: string;
  children: string;
}

export function Pill({ tone, id, children }: PillProps) {
  return (
    <span class={tone ? `pill pill--${tone}` : "pill"} id={id}>
      {children}
    </span>
  );
}
