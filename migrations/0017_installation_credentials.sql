-- Proof of possession for newly provisioned installations. Never store the
-- bearer secret itself; it is held in path-scoped HttpOnly cookies.
CREATE TABLE IF NOT EXISTS installation_credentials (
  device_id TEXT PRIMARY KEY NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
