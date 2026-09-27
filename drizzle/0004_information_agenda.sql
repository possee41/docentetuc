ALTER TABLE saved_publications ADD COLUMN agenda_at TEXT;
ALTER TABLE saved_publications ADD COLUMN agenda_notes TEXT NOT NULL DEFAULT '';
