-- Local proposal only. Preserves public Junta snapshots atomically with each write.
-- No personal data, no notification queue, no destructive backfill.
CREATE TABLE IF NOT EXISTS juntas_document_revisions (
  revision_id INTEGER PRIMARY KEY,
  publication_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  recorded_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  snapshot_json TEXT NOT NULL CHECK(json_valid(snapshot_json)),
  UNIQUE(publication_id,content_hash)
);
CREATE INDEX IF NOT EXISTS idx_juntas_revisions_publication ON juntas_document_revisions(publication_id,revision_id DESC);

CREATE TRIGGER IF NOT EXISTS trg_juntas_revision_created AFTER INSERT ON publications
WHEN NEW.source='Padrones y Comunicados' AND NEW.kind='junta'
BEGIN
  INSERT INTO juntas_document_revisions(publication_id,content_hash,snapshot_json)
  VALUES(NEW.id,NEW.content_hash,json_object('id',NEW.id,'source',NEW.source,'external_id',NEW.external_id,'kind',NEW.kind,'category',NEW.category,'title',NEW.title,'summary',NEW.summary,'junta',NEW.junta,'level',NEW.level,'area',NEW.area,'location',NEW.location,'shift',NEW.shift,'character',NEW.character,'starts_at',NEW.starts_at,'ends_at',NEW.ends_at,'official_url',NEW.official_url,'metadata',NEW.metadata,'content_hash',NEW.content_hash,'source_updated_at',NEW.source_updated_at,'source_published_at',NEW.source_published_at,'status',NEW.status,'normalized_status',NEW.normalized_status)) ON CONFLICT(publication_id,content_hash) DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS trg_juntas_revision_previous BEFORE UPDATE ON publications
WHEN OLD.source='Padrones y Comunicados' AND OLD.kind='junta' AND OLD.content_hash<>NEW.content_hash
BEGIN
  INSERT INTO juntas_document_revisions(publication_id,content_hash,snapshot_json)
  VALUES(OLD.id,OLD.content_hash,json_object('id',OLD.id,'source',OLD.source,'external_id',OLD.external_id,'kind',OLD.kind,'category',OLD.category,'title',OLD.title,'summary',OLD.summary,'junta',OLD.junta,'level',OLD.level,'area',OLD.area,'location',OLD.location,'shift',OLD.shift,'character',OLD.character,'starts_at',OLD.starts_at,'ends_at',OLD.ends_at,'official_url',OLD.official_url,'metadata',OLD.metadata,'content_hash',OLD.content_hash,'source_updated_at',OLD.source_updated_at,'source_published_at',OLD.source_published_at,'status',OLD.status,'normalized_status',OLD.normalized_status)) ON CONFLICT(publication_id,content_hash) DO NOTHING;
END;

CREATE TRIGGER IF NOT EXISTS trg_juntas_revision_changed AFTER UPDATE ON publications
WHEN NEW.source='Padrones y Comunicados' AND NEW.kind='junta' AND OLD.content_hash<>NEW.content_hash
BEGIN
  INSERT INTO juntas_document_revisions(publication_id,content_hash,snapshot_json)
  VALUES(NEW.id,NEW.content_hash,json_object('id',NEW.id,'source',NEW.source,'external_id',NEW.external_id,'kind',NEW.kind,'category',NEW.category,'title',NEW.title,'summary',NEW.summary,'junta',NEW.junta,'level',NEW.level,'area',NEW.area,'location',NEW.location,'shift',NEW.shift,'character',NEW.character,'starts_at',NEW.starts_at,'ends_at',NEW.ends_at,'official_url',NEW.official_url,'metadata',NEW.metadata,'content_hash',NEW.content_hash,'source_updated_at',NEW.source_updated_at,'source_published_at',NEW.source_published_at,'status',NEW.status,'normalized_status',NEW.normalized_status)) ON CONFLICT(publication_id,content_hash) DO NOTHING;
END;

-- Supports newest-first public notices without sorting the full corpus.
CREATE INDEX IF NOT EXISTS idx_juntas_notices_date ON publications(source,kind,coalesce(source_published_at,'') DESC,id) WHERE source='Padrones y Comunicados' AND kind='junta';
