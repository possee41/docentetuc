CREATE TABLE IF NOT EXISTS manual_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL DEFAULT 'Personal',
  starts_at TEXT NOT NULL,
  reminder_at TEXT,
  reminder_notified INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_manual_events_user_date ON manual_events(user_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_manual_events_reminder ON manual_events(reminder_at, reminder_notified);
