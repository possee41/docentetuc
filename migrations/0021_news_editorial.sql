-- Editorial news is opt-in: synchronized publications are never published automatically.
CREATE TABLE news_items (
  id TEXT PRIMARY KEY NOT NULL,
  origin_publication_id TEXT REFERENCES publications(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'candidate' CHECK(status IN ('candidate', 'approved', 'published', 'rejected', 'archived')),
  editorial_title TEXT NOT NULL DEFAULT '',
  editorial_summary TEXT NOT NULL DEFAULT '',
  topic TEXT,
  relevance TEXT NOT NULL DEFAULT 'informativa' CHECK(relevance IN ('informativa', 'importante', 'urgente')),
  featured INTEGER NOT NULL DEFAULT 0 CHECK(featured IN (0, 1)),
  valid_from TEXT,
  valid_until TEXT,
  approved_at TEXT,
  published_at TEXT,
  created_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  approved_by_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  replaced_by_news_id TEXT REFERENCES news_items(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(valid_from IS NULL OR (valid_from GLOB '????-??-??T??:??:??.???Z' AND strftime('%Y-%m-%dT%H:%M:%fZ', valid_from) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', valid_from) = valid_from)),
  CHECK(valid_until IS NULL OR (valid_until GLOB '????-??-??T??:??:??.???Z' AND strftime('%Y-%m-%dT%H:%M:%fZ', valid_until) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', valid_until) = valid_until)),
  CHECK(valid_from IS NULL OR valid_until IS NULL OR valid_until > valid_from),
  CHECK(replaced_by_news_id IS NULL OR replaced_by_news_id <> id)
);
CREATE UNIQUE INDEX idx_news_items_origin ON news_items(origin_publication_id) WHERE origin_publication_id IS NOT NULL;
CREATE INDEX idx_news_items_status_updated ON news_items(status, updated_at DESC);
CREATE INDEX idx_news_items_public_window ON news_items(valid_from, valid_until, published_at DESC) WHERE status = 'published';

CREATE TABLE news_sources (
  id TEXT PRIMARY KEY NOT NULL,
  news_item_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE RESTRICT,
  publication_id TEXT REFERENCES publications(id) ON DELETE SET NULL,
  source_name TEXT NOT NULL,
  source_title TEXT NOT NULL,
  url TEXT NOT NULL CHECK(url LIKE 'https://%' AND length(url) <= 2048),
  normalized_url TEXT NOT NULL CHECK(normalized_url LIKE 'https://%' AND length(normalized_url) <= 2048),
  source_type TEXT NOT NULL CHECK(source_type IN ('official', 'public', 'union', 'media')),
  is_primary INTEGER NOT NULL DEFAULT 0 CHECK(is_primary IN (0, 1)),
  position INTEGER NOT NULL DEFAULT 0 CHECK(position >= 0),
  source_published_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX idx_news_sources_primary ON news_sources(news_item_id) WHERE is_primary = 1;
CREATE UNIQUE INDEX idx_news_sources_publication ON news_sources(news_item_id, publication_id) WHERE publication_id IS NOT NULL;
CREATE UNIQUE INDEX idx_news_sources_url ON news_sources(news_item_id, normalized_url);
CREATE INDEX idx_news_sources_publication_lookup ON news_sources(publication_id) WHERE publication_id IS NOT NULL;
CREATE INDEX idx_news_sources_url_lookup ON news_sources(normalized_url);

CREATE TABLE news_events (
  id TEXT PRIMARY KEY NOT NULL,
  news_item_id TEXT NOT NULL REFERENCES news_items(id) ON DELETE RESTRICT,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  actor_kind TEXT NOT NULL CHECK(actor_kind IN ('admin', 'system')),
  action TEXT NOT NULL CHECK(action IN ('create_candidate', 'edit', 'approve', 'publish', 'reject', 'archive', 'reopen', 'feature', 'unfeature', 'source_add', 'source_remove')),
  previous_status TEXT CHECK(previous_status IS NULL OR previous_status IN ('candidate', 'approved', 'published', 'rejected', 'archived')),
  next_status TEXT CHECK(next_status IS NULL OR next_status IN ('candidate', 'approved', 'published', 'rejected', 'archived')),
  details TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(details) AND length(details) <= 2048),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX idx_news_events_item_created ON news_events(news_item_id, created_at DESC);
