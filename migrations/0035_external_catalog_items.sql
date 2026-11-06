-- External catalog items (FDCI, etc.) with stable identifiers.
-- Prepared locally. NOT applied to any remote D1.
-- Reuses the existing saved_publications/agenda/reminder mechanisms
-- by storing external items in publications with source='FDCI'.

-- Table to track external catalog item metadata (optional, for future use).
CREATE TABLE IF NOT EXISTS external_catalog_items (
  id TEXT PRIMARY KEY NOT NULL,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'capacitacion',
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  level TEXT,
  area TEXT,
  location TEXT,
  character TEXT,
  junta TEXT,
  shift TEXT,
  starts_at TEXT,
  ends_at TEXT,
  status TEXT NOT NULL DEFAULT 'vigente',
  official_url TEXT NOT NULL,
  registration_open_at TEXT,
  registration_close_at TEXT,
  normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN',
  source_published_at TEXT,
  metadata TEXT NOT NULL DEFAULT '{}',
  removed_at TEXT,
  first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_external_catalog_source ON external_catalog_items(source, external_id);
CREATE INDEX IF NOT EXISTS idx_external_catalog_removed ON external_catalog_items(removed_at);
