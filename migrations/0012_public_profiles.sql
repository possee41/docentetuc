-- Keep user-chosen public identity separate from the private matching profile.
-- user_id is an internal association only; it is not public authentication.
CREATE TABLE IF NOT EXISTS public_profiles (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  avatar_id TEXT NOT NULL DEFAULT 'avatar_01',
  bio TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
