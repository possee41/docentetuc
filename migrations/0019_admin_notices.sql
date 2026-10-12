-- Admin V1: manual home notices, additive and independent of synchronized publications.
CREATE TABLE IF NOT EXISTS admin_notices (
  id TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  priority TEXT NOT NULL CHECK (priority IN ('normal', 'importante', 'urgente')),
  starts_at TEXT,
  ends_at TEXT,
  url TEXT,
  active INTEGER NOT NULL DEFAULT 0 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  updated_by TEXT REFERENCES "user"(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_notices_active_window ON admin_notices(active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS admin_notice_events (
  id TEXT PRIMARY KEY NOT NULL,
  notice_id TEXT NOT NULL REFERENCES admin_notices(id),
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'edit')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_admin_notice_events_notice ON admin_notice_events(notice_id, created_at);
