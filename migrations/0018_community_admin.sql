-- Only a trusted D1 operator may grant or revoke admin. No public role endpoint exists.
ALTER TABLE community_moderators ADD COLUMN role TEXT NOT NULL DEFAULT 'moderator'
  CHECK(role IN ('moderator', 'admin'));

-- Review decisions retain only minimal metadata; deleting an account detaches its actor.
CREATE TABLE IF NOT EXISTS community_report_reviews (
  id TEXT PRIMARY KEY NOT NULL,
  report_id TEXT REFERENCES community_reports(id) ON DELETE SET NULL,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('resolve', 'dismiss')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_community_report_reviews_recent
  ON community_report_reviews(created_at DESC);
