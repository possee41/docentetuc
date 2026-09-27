ALTER TABLE saved_publications ADD COLUMN agenda_reminder_at TEXT;
ALTER TABLE saved_publications ADD COLUMN agenda_reminder_notified INTEGER NOT NULL DEFAULT 0;
