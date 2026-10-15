// Copyright (C) 2026 SS Enterprises. Licensed under the GNU AGPL v3 or later; see LICENSE.
import { beforeEach, describe, expect, it } from "vitest";
import init from "../migrations/0001_init.sql";
import { statements } from "../src/schema";
import { resetDb, testEnv } from "./helpers";

describe("schema", () => {
  beforeEach(resetDb);
  it("creates every table the app uses, and is safe to apply twice", async () => {
    await testEnv.DB.batch(statements(init).map((s) => testEnv.DB.prepare(s)));
    const { results } = await testEnv.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'").all<{ name: string }>();
    expect(results.map((r) => r.name).sort()).toEqual(["conversations", "events", "outbox", "processed", "rules", "sends", "settings"]);
  });
});
