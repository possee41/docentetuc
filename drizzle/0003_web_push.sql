CREATE TABLE `push_subscriptions` (
  `endpoint` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `device_id` text NOT NULL,
  `p256dh` text NOT NULL,
  `auth` text NOT NULL,
  `expiration_time` integer,
  `user_agent` text DEFAULT '' NOT NULL,
  `active` integer DEFAULT 1 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `last_seen_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `idx_push_subscriptions_user` ON `push_subscriptions` (`user_id`,`active`);

CREATE TABLE `push_preferences` (
  `user_id` text PRIMARY KEY NOT NULL,
  `enabled` integer DEFAULT 1 NOT NULL,
  `vacancies` integer DEFAULT 1 NOT NULL,
  `trainings` integer DEFAULT 1 NOT NULL,
  `commissions` integer DEFAULT 1 NOT NULL,
  `reminders` integer DEFAULT 1 NOT NULL,
  `date_changes` integer DEFAULT 1 NOT NULL,
  `closing_soon` integer DEFAULT 1 NOT NULL,
  `boards` integer DEFAULT 0 NOT NULL,
  `quiet_start` text DEFAULT '22:00' NOT NULL,
  `quiet_end` text DEFAULT '07:00' NOT NULL,
  `timezone` text DEFAULT 'America/Argentina/Buenos_Aires' NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);

CREATE TABLE `push_deliveries` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `endpoint` text NOT NULL,
  `notification_id` integer NOT NULL,
  `event_key` text NOT NULL,
  `status` text DEFAULT 'pending' NOT NULL,
  `attempts` integer DEFAULT 0 NOT NULL,
  `last_error` text,
  `sent_at` text,
  `next_attempt_at` text,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE UNIQUE INDEX `idx_push_deliveries_unique` ON `push_deliveries` (`endpoint`,`event_key`);
CREATE INDEX `idx_push_deliveries_retry` ON `push_deliveries` (`status`,`next_attempt_at`);

CREATE TABLE `push_rate_limits` (
  `user_bucket` text PRIMARY KEY NOT NULL,
  `request_count` integer DEFAULT 0 NOT NULL,
  `expires_at` text NOT NULL
);
