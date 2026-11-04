-- Operator-approved, finite FDCI automation window. No public recovery operation.
CREATE TABLE IF NOT EXISTS fdci_automation_control (
  id INTEGER PRIMARY KEY CHECK(id=1),
  status TEXT NOT NULL DEFAULT 'HALTED' CHECK(status IN ('IDLE','RUNNING','HALTED')),
  approved_sha TEXT,
  not_before TEXT,
  not_after TEXT,
  last_slot INTEGER NOT NULL DEFAULT -1,
  owner TEXT NOT NULL DEFAULT '',
  grant_id TEXT NOT NULL DEFAULT '',
  lease_until TEXT,
  publication_attempts INTEGER NOT NULL DEFAULT 0 CHECK(publication_attempts BETWEEN 0 AND 2),
  last_result TEXT,
  halt_reason TEXT
);
INSERT INTO fdci_automation_control(id) VALUES(1) ON CONFLICT(id) DO NOTHING;
