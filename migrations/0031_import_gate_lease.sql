-- Short-lived, single-row import lease. The gateway refuses imports once
-- expires_at passes, so a runner that dies without closing the gate cannot
-- leave it open. The row is created and removed only by authenticated runners.
CREATE TABLE IF NOT EXISTS import_gate_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL
);
