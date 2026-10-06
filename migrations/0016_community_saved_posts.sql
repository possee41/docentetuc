-- Private bookmark relationships. No publication text or public aggregate is stored.
CREATE TABLE IF NOT EXISTS community_saved_posts (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, post_id)
);

CREATE INDEX IF NOT EXISTS idx_community_saved_posts_user_saved
  ON community_saved_posts(user_id, saved_at DESC, post_id DESC);
CREATE INDEX IF NOT EXISTS idx_community_saved_posts_post
  ON community_saved_posts(post_id);
