-- Preventive review is additive. Existing visible content is implicitly approved.
-- Pending/rejected content is also hidden in the original Community tables so
-- every existing public feed, direct lookup and saved-post query fails closed.
CREATE TABLE IF NOT EXISTS community_pre_moderation (
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
  decision TEXT NOT NULL CHECK(decision IN ('approved', 'pending_review', 'rejected')),
  categories TEXT NOT NULL DEFAULT '[]',
  confidence REAL NOT NULL DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 1),
  reason TEXT NOT NULL DEFAULT '',
  decision_source TEXT NOT NULL CHECK(decision_source IN ('automatic', 'manual')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_by TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  reviewed_at TEXT,
  PRIMARY KEY(target_type, post_id, comment_id),
  CHECK((target_type='post' AND post_id IS NOT NULL AND comment_id IS NULL)
    OR (target_type='comment' AND comment_id IS NOT NULL AND post_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_moderation_post ON community_pre_moderation(post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_pre_moderation_comment ON community_pre_moderation(comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_pre_moderation_queue ON community_pre_moderation(decision, created_at);

CREATE TABLE IF NOT EXISTS community_pre_moderation_events (
  id TEXT PRIMARY KEY NOT NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('approved', 'pending_review', 'rejected', 'manual_approved', 'manual_rejected')),
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK((target_type='post' AND post_id IS NOT NULL AND comment_id IS NULL)
    OR (target_type='comment' AND comment_id IS NOT NULL AND post_id IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_pre_moderation_events_recent ON community_pre_moderation_events(created_at DESC);

CREATE TABLE IF NOT EXISTS community_user_restrictions (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_user_restriction_events (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT REFERENCES "user"(id) ON DELETE CASCADE,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('block', 'unblock')),
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_user_restriction_events_recent ON community_user_restriction_events(created_at DESC);
