-- Local preparation only. Optional FDCI delta mode remains disabled by default.
CREATE TABLE fdci_delta_state (
  id INTEGER PRIMARY KEY CHECK(id=1),
  revision INTEGER NOT NULL DEFAULT 0 CHECK(revision>=0),
  stage_token TEXT NOT NULL DEFAULT '',
  stage_owner TEXT NOT NULL DEFAULT '',
  last_staged_id TEXT NOT NULL DEFAULT '',
  last_complete_scan_at TEXT,
  detail_after TEXT NOT NULL DEFAULT '',
  detail_upper TEXT NOT NULL DEFAULT '',
  detail_cycle INTEGER NOT NULL DEFAULT 1 CHECK(detail_cycle>0)
);
INSERT INTO fdci_delta_state(id) VALUES(1);
CREATE TABLE fdci_delta_queue (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  publication_id TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL CHECK(length(content_hash)=64),
  payload TEXT NOT NULL CHECK(json_valid(payload)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0)
);
