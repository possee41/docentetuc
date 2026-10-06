-- DocenteTuc 1.1 Community Phase 3A. Apply to local/test D1 only for this phase.
-- All content is plain text; identities stay server-side and public reads join
-- only the explicitly public profile fields.

CREATE TABLE IF NOT EXISTS community_rules_acceptances (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  rules_version TEXT NOT NULL,
  accepted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_moderators (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS community_posts (
  id TEXT PRIMARY KEY NOT NULL,
  author_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'visible'
    CHECK(moderation_status IN ('visible', 'hidden', 'removed')),
  moderated_at TEXT,
  moderation_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_community_posts_visible_created
  ON community_posts(moderation_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_community_posts_author
  ON community_posts(author_user_id, created_at DESC);

-- Comments are direct children of a publication. There is intentionally no
-- parent-comment field, so nested/infinite reply trees cannot be created.
CREATE TABLE IF NOT EXISTS community_comments (
  id TEXT PRIMARY KEY NOT NULL,
  post_id TEXT NOT NULL REFERENCES community_posts(id) ON DELETE CASCADE,
  author_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  body TEXT NOT NULL CHECK(length(trim(body)) BETWEEN 1 AND 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  edited_at TEXT,
  moderation_status TEXT NOT NULL DEFAULT 'visible'
    CHECK(moderation_status IN ('visible', 'hidden', 'removed')),
  moderated_at TEXT,
  moderation_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_community_comments_post_created
  ON community_comments(post_id, moderation_status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_community_comments_author
  ON community_comments(author_user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_reports (
  id TEXT PRIMARY KEY NOT NULL,
  reporter_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN (
    'off_topic', 'harassment', 'discrimination', 'personal_data', 'spam', 'illegal', 'other'
  )),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewed', 'dismissed', 'actioned')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(
    (target_type = 'post' AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (target_type = 'comment' AND comment_id IS NOT NULL AND post_id IS NULL)
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_reports_once_per_post
  ON community_reports(reporter_user_id, post_id) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_community_reports_once_per_comment
  ON community_reports(reporter_user_id, comment_id) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_community_reports_queue
  ON community_reports(status, created_at ASC);

CREATE TABLE IF NOT EXISTS community_blocks (
  id TEXT PRIMARY KEY NOT NULL,
  blocker_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  blocked_user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(blocker_user_id <> blocked_user_id),
  UNIQUE(blocker_user_id, blocked_user_id)
);
CREATE INDEX IF NOT EXISTS idx_community_blocks_blocked
  ON community_blocks(blocked_user_id, blocker_user_id);

-- Internal-only audit metadata: no content snapshots, email or device IDs.
-- On the 90-day retention purge, target IDs are detached and the minimal
-- action/reason/date audit remains. Deleting a moderator nulls actor ID.
CREATE TABLE IF NOT EXISTS community_moderation_events (
  id TEXT PRIMARY KEY NOT NULL,
  actor_user_id TEXT REFERENCES "user"(id) ON DELETE SET NULL,
  target_type TEXT NOT NULL CHECK(target_type IN ('post', 'comment')),
  post_id TEXT REFERENCES community_posts(id) ON DELETE CASCADE,
  comment_id TEXT REFERENCES community_comments(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('hide', 'restore', 'remove')),
  reason TEXT NOT NULL CHECK(reason IN (
    'off_topic', 'harassment', 'discrimination', 'personal_data', 'spam', 'illegal', 'other'
  )),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK(
    (target_type = 'post' AND post_id IS NOT NULL AND comment_id IS NULL) OR
    (target_type = 'comment' AND comment_id IS NOT NULL AND post_id IS NULL) OR
    (post_id IS NULL AND comment_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_community_moderation_target
  ON community_moderation_events(target_type, post_id, comment_id, created_at DESC);

CREATE TABLE IF NOT EXISTS community_rate_limits (
  user_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK(action IN ('post', 'comment', 'report')),
  window_key INTEGER NOT NULL,
  request_count INTEGER NOT NULL CHECK(request_count > 0),
  PRIMARY KEY(user_id, action, window_key)
);
