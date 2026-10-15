// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { ComponentChildren } from "preact";

interface CardProps {
  title?: string;
  id?: string;
  children: ComponentChildren;
}

export function Card({ title, id, children }: CardProps) {
  return (
    <section class="card" id={id}>
      {title && <h2 class="card__title">{title}</h2>}
      {children}
    </section>
  );
}
