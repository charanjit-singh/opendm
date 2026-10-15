// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.

export function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div class="card stat">
      <span class="stat__value">{value}</span>
      <span class="stat__label">{label}</span>
    </div>
  );
}
