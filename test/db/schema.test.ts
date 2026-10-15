// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it } from "vitest";
import { ensureSchema, MIGRATIONS, statements } from "../../src/db/schema";
import { resetDb, testEnv } from "../support/helpers";

describe("schema", () => {
  beforeEach(resetDb);
  it("creates every table the app uses, and is safe to apply twice", async () => {
    // Running every migration again must change nothing (upgraded databases do this on each cold start).
    await ensureSchema(testEnv.DB);
    const { results } = await testEnv.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'",
    ).all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual([
      "conversations",
      "events",
      "outbox",
      "processed",
      "rules",
      "sends",
      "settings",
      "variant_counters",
    ]);
  });
});

describe("migrations files", () => {
  it("each migration file is non-empty and made of single statements", () => {
    for (const sql of MIGRATIONS) expect(statements(sql).length).toBeGreaterThan(0);
  });
});
