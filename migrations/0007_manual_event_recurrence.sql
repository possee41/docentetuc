ALTER TABLE manual_events ADD COLUMN all_day INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manual_events ADD COLUMN recurrence TEXT NOT NULL DEFAULT 'none';
ALTER TABLE manual_events ADD COLUMN reminder_minutes INTEGER;

CREATE TABLE IF NOT EXISTS manual_event_push_queue (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  event_id TEXT NOT NULL REFERENCES manual_events(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  occurrence_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(event_id, occurrence_at)
);
CREATE INDEX IF NOT EXISTS idx_manual_event_push_due ON manual_event_push_queue(created_at, user_id);
