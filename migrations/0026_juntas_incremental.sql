-- External Juntas runner only. Existing publications and editorial tables are untouched.
CREATE TABLE IF NOT EXISTS juntas_import_checkpoint (
  root_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  state_json TEXT NOT NULL CHECK (json_valid(state_json)),
  status TEXT NOT NULL CHECK (status IN ('PARTIAL', 'OK')),
  last_attempt_at TEXT,
  last_success_at TEXT,
  error_code TEXT,
  lease_owner TEXT,
  lease_until TEXT
);

-- A file is complete only after all its derived publications were applied.
CREATE TABLE IF NOT EXISTS juntas_import_applied (
  root_id TEXT NOT NULL,
  file_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  PRIMARY KEY (root_id, file_id)
);
