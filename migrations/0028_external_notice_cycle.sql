-- Hourly, replay-safe cursor for external date-based training notices.
CREATE TABLE IF NOT EXISTS external_notice_cycle (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cycle_at TEXT NOT NULL DEFAULT '',
  profile_cursor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('pending', 'done')),
  lease_owner TEXT,
  lease_until TEXT,
  completed_at TEXT
);
INSERT OR IGNORE INTO external_notice_cycle(id) VALUES (1);
