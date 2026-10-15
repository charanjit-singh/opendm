// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
// The schema is applied on the first request, so a one-click deploy needs no separate migrate step.
// `migrations/*.sql` hold the same statements for `wrangler d1 migrations apply`; test/db/schema.test.ts keeps them in sync.
import init from "../../migrations/0001_init.sql";
import channelsAndVariants from "../../migrations/0002_channels_variants.sql";

export const MIGRATIONS: string[] = [init, channelsAndVariants];

/** Splits a migration file into single statements (D1 runs one at a time), dropping comment lines. */
export const statements = (sql: string): string[] =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);

/** Re-running `ALTER TABLE ... ADD COLUMN` on an upgraded database is expected and harmless. */
const isAlreadyApplied = (error: unknown) => /duplicate column name/i.test(String((error as Error).message));

async function applyAll(db: D1Database): Promise<void> {
  for (const migration of MIGRATIONS) {
    for (const sql of statements(migration)) {
      try {
        await db.prepare(sql).run();
      } catch (error) {
        if (!isAlreadyApplied(error)) throw error;
      }
    }
  }
}

let ready: Promise<void> | null = null;

export function ensureSchema(db: D1Database): Promise<void> {
  ready ??= applyAll(db).catch((error) => {
    ready = null;
    throw error;
  });
  return ready;
}

/** Tests reset the in-memory flag between isolated storage runs. */
export const resetSchemaCache = () => {
  ready = null;
};
