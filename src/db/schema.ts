// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The schema is applied on first request, so a one-click deploy works without a separate migrate step.
// `migrations/0001_init.sql` holds the same statements for `wrangler d1 migrations apply`; test/schema.test.ts keeps them in sync.
import init from "../../migrations/0001_init.sql";

export const statements = (sql: string) =>
  sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= db
    .batch(statements(init).map((s) => db.prepare(s)))
    .then(() => undefined)
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}

/** Tests reset the in-memory flag between isolated storage runs. */
export const resetSchemaCache = () => {
  ready = null;
};
