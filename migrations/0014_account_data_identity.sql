-- DocenteTuc 1.1: explicit, authenticated ownership of legacy installations.
-- Apply only to a local/test D1 until production rollout is separately approved.
CREATE TABLE IF NOT EXISTS account_installations (
  device_id TEXT PRIMARY KEY NOT NULL,
  source_user_id TEXT NOT NULL UNIQUE,
  account_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_account_installations_account
  ON account_installations(account_id);
