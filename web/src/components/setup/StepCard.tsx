// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import type { ComponentChildren } from "preact";
import type { SetupStep } from "../../../../src/types/api";

const ICON = { ok: "✓", todo: "○", warn: "!", info: "i" } as const;

interface StepCardProps {
  step: SetupStep;
  index: number;
  children?: ComponentChildren;
}

/** One checklist step: a status mark, what the check found, and the controls that complete it. */
export function StepCard({ step, index, children }: StepCardProps) {
  return (
    <section class={`card step step--${step.status}`} id={`setup-step-${step.id}`} data-status={step.status}>
      <div class="step__head">
        <span class="step__mark" aria-hidden="true">
          {ICON[step.status]}
        </span>
        <div class="step__title">
          <h2 class="card__title card__title--flush">
            {index}. {step.title}
          </h2>
          <p class="hint step__detail">{step.detail}</p>
        </div>
      </div>
      {step.status !== "ok" && step.help && <p class="step__help">{step.help}</p>}
      {children}
    </section>
  );
}
