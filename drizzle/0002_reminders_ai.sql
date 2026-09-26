ALTER TABLE `profiles` ADD `notify_new_trainings` integer DEFAULT 0 NOT NULL;
ALTER TABLE `profiles` ADD `training_notify_scope` text DEFAULT 'relevant' NOT NULL;
CREATE TABLE `training_reminders` (
  `id` text PRIMARY KEY NOT NULL,
  `user_id` text NOT NULL,
  `training_id` text NOT NULL,
  `publication_id` text NOT NULL,
  `opens_at` text NOT NULL,
  `precision` text NOT NULL,
  `advance_minutes` integer,
  `remind_at` text NOT NULL,
  `notified` integer DEFAULT 0 NOT NULL,
  `created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
  `updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
CREATE INDEX `idx_training_reminders_user` ON `training_reminders` (`user_id`);
CREATE INDEX `idx_training_reminders_due` ON `training_reminders` (`remind_at`,`notified`);
CREATE TABLE `ai_rate_limits` (
  `user_bucket` text PRIMARY KEY NOT NULL,
  `request_count` integer DEFAULT 0 NOT NULL,
  `expires_at` text NOT NULL
);
