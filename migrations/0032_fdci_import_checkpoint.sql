-- FDCI active-cycle progress only; no publications, identities or sync_state changes.
CREATE TABLE IF NOT EXISTS fdci_import_checkpoint (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0),
  cycle INTEGER NOT NULL DEFAULT 1 CHECK (cycle >= 1),
  after_key TEXT NOT NULL DEFAULT '',
  upper_key TEXT NOT NULL DEFAULT '',
  failures INTEGER NOT NULL DEFAULT 0 CHECK (failures >= 0),
  last_error_code TEXT,
  last_cycle_status TEXT CHECK (last_cycle_status IN ('OK','PARTIAL')),
  last_completed_at TEXT
);
INSERT INTO fdci_import_checkpoint(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
