// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { ComponentChildren } from "preact";

interface CardProps {
  title?: string;
  id?: string;
  hidden?: boolean;
  children: ComponentChildren;
}

export function Card({ title, id, hidden, children }: CardProps) {
  return (
    <section class="card" id={id} hidden={hidden}>
      {title && <h2 class="card__title">{title}</h2>}
      {children}
    </section>
  );
}
