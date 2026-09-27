ALTER TABLE profiles ADD COLUMN roles TEXT NOT NULL DEFAULT '';
ALTER TABLE push_preferences ADD COLUMN designation_exact INTEGER NOT NULL DEFAULT 1;
ALTER TABLE push_preferences ADD COLUMN designation_partial INTEGER NOT NULL DEFAULT 1;
ALTER TABLE push_preferences ADD COLUMN designation_roles INTEGER NOT NULL DEFAULT 1;

CREATE TABLE designation_tracking (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'GUARDADO',
  role TEXT NOT NULL DEFAULT '',
  subject TEXT NOT NULL DEFAULT '',
  school TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  locality TEXT NOT NULL DEFAULT '',
  applied_at TEXT,
  appointment_at TEXT,
  shift TEXT NOT NULL DEFAULT '',
  board TEXT NOT NULL DEFAULT '',
  documentation TEXT NOT NULL DEFAULT '',
  order_number TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  official_url TEXT NOT NULL DEFAULT '',
  reminder_at TEXT,
  reminder_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_designation_tracking_user ON designation_tracking(user_id, appointment_at);
CREATE INDEX idx_designation_tracking_reminder ON designation_tracking(reminder_at, reminder_notified);

