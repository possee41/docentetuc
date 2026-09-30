-- Keep a complete last-known snapshot separate from the in-progress Drive traversal.
-- Missing documents are reconciled only after every root has a completed snapshot.
CREATE TABLE IF NOT EXISTS board_crawl_state (
  root_id TEXT PRIMARY KEY,
  queue_json TEXT NOT NULL,
  visited_json TEXT NOT NULL,
  working_json TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  completed_at TEXT,
  last_attempt_at TEXT NOT NULL,
  error TEXT
);
