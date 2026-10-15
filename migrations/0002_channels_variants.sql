-- OpenDM schema, part 2: Facebook channel, DM triggers, message variants. Copyright (C) 2026 SS Enterprises, AGPL-3.0-or-later.
ALTER TABLE rules ADD COLUMN channel TEXT NOT NULL DEFAULT 'instagram';
ALTER TABLE rules ADD COLUMN dm_trigger INTEGER NOT NULL DEFAULT 0;
ALTER TABLE conversations ADD COLUMN platform TEXT NOT NULL DEFAULT 'instagram';
ALTER TABLE events ADD COLUMN variant TEXT;
ALTER TABLE events ADD COLUMN platform TEXT;
CREATE TABLE IF NOT EXISTS variant_counters (rule_id INTEGER NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (rule_id, key));
