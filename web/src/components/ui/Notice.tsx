// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { ComponentChildren } from "preact";

interface NoticeProps {
  kind: "ok" | "error";
  id?: string;
  children: ComponentChildren;
}

export function Notice({ kind, id, children }: NoticeProps) {
  return (
    <div class={`notice notice--${kind}`} id={id}>
      {children}
    </div>
  );
}
