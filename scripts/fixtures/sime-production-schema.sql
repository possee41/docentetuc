CREATE TABLE import_gate_lease (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  opened_at TEXT NOT NULL,
  opened_by TEXT NOT NULL
);
CREATE TABLE import_gateway_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  database_name TEXT NOT NULL,
  database_id TEXT NOT NULL
);
CREATE TABLE `publications` (
	`id` text PRIMARY KEY NOT NULL,
	`source` text NOT NULL,
	`external_id` text NOT NULL,
	`kind` text NOT NULL,
	`category` text NOT NULL,
	`title` text NOT NULL,
	`summary` text DEFAULT '' NOT NULL,
	`level` text DEFAULT '' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`junta` text DEFAULT '' NOT NULL,
	`location` text DEFAULT '' NOT NULL,
	`shift` text DEFAULT '' NOT NULL,
	`character` text DEFAULT '' NOT NULL,
	`starts_at` text,
	`ends_at` text,
	`status` text DEFAULT 'vigente' NOT NULL,
	`official_url` text NOT NULL,
	`content_hash` text NOT NULL,
	`source_updated_at` text,
	`first_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
, `metadata` text DEFAULT '{}' NOT NULL, circuit TEXT NOT NULL DEFAULT 'UNKNOWN', source_circuit_raw TEXT NOT NULL DEFAULT '', circuit_inference_source TEXT NOT NULL DEFAULT 'unknown', last_seen_at TEXT NOT NULL DEFAULT '', last_changed_at TEXT NOT NULL DEFAULT '', source_published_at TEXT, registration_open_at TEXT, registration_close_at TEXT, expires_at TEXT, source_status TEXT NOT NULL DEFAULT 'UNKNOWN', normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN', removed_at TEXT, circuit_confidence INTEGER NOT NULL DEFAULT 0);
CREATE TABLE `sync_state` (
	`source` text PRIMARY KEY NOT NULL,
	`synced_at` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`error` text
, last_attempt_at TEXT, last_successful_sync_at TEXT, last_content_change_at TEXT, records_created INTEGER NOT NULL DEFAULT 0, records_updated INTEGER NOT NULL DEFAULT 0, records_removed INTEGER NOT NULL DEFAULT 0, sync_status TEXT NOT NULL DEFAULT 'UNKNOWN', error_code TEXT, error_message TEXT, parser_version TEXT NOT NULL DEFAULT '1', records_expired INTEGER NOT NULL DEFAULT 0);
CREATE INDEX `idx_publications_kind_ends` ON `publications` (`kind`,`ends_at`);
CREATE INDEX idx_publications_kind_id ON publications(kind, id);
CREATE INDEX idx_publications_kind_updated ON publications(kind, updated_at DESC, id DESC);
CREATE INDEX idx_publications_lifecycle ON publications(normalized_status, kind, source);
CREATE INDEX `idx_publications_source_external` ON `publications` (`source`,`external_id`);
CREATE INDEX idx_publications_source_id ON publications(source, id);
CREATE INDEX idx_sync_state_status ON sync_state(sync_status, last_successful_sync_at);
