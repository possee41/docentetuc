-- 0023/0024 are reserved by the separate 1.1 hotfix. This migration is additive.
-- The trigger and publication write are one SQLite statement: a crash cannot
-- persist a publication without its notification event.
CREATE TABLE external_publication_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  change TEXT NOT NULL CHECK(change IN ('created', 'updated')),
  profile_cursor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'done', 'superseded')),
  lease_owner TEXT,
  lease_until TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_external_publication_events_pending
  ON external_publication_events(status, lease_until, id);

CREATE TRIGGER trg_external_publication_created
AFTER INSERT ON publications
WHEN NEW.source IN ('Capacitación Docente', 'SIME', 'Padrones y Comunicados', 'CeNET / INET', 'INFoD / AulaS-TIC')
BEGIN
  INSERT INTO external_publication_events(publication_id, content_hash, change)
  VALUES(NEW.id, NEW.content_hash, 'created');
END;

CREATE TRIGGER trg_external_publication_updated
AFTER UPDATE OF content_hash, removed_at ON publications
WHEN NEW.source IN ('Capacitación Docente', 'SIME', 'Padrones y Comunicados', 'CeNET / INET', 'INFoD / AulaS-TIC')
  AND (OLD.content_hash <> NEW.content_hash OR (OLD.removed_at IS NOT NULL AND NEW.removed_at IS NULL))
BEGIN
  INSERT INTO external_publication_events(publication_id, content_hash, change)
  VALUES(NEW.id, NEW.content_hash, 'updated');
END;
