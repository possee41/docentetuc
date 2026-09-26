CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text DEFAULT 'Docente' NOT NULL,
	`email` text,
	`level` text DEFAULT '' NOT NULL,
	`area` text DEFAULT '' NOT NULL,
	`subjects` text DEFAULT '' NOT NULL,
	`junta` text DEFAULT '' NOT NULL,
	`department` text DEFAULT '' NOT NULL,
	`locality` text DEFAULT '' NOT NULL,
	`shifts` text DEFAULT '' NOT NULL,
	`wants_interim` integer DEFAULT true NOT NULL,
	`wants_substitute` integer DEFAULT true NOT NULL,
	`training_interests` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
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
);
--> statement-breakpoint
CREATE INDEX `idx_publications_kind_ends` ON `publications` (`kind`,`ends_at`);
--> statement-breakpoint
CREATE INDEX `idx_publications_source_external` ON `publications` (`source`,`external_id`);
--> statement-breakpoint
CREATE TABLE `saved_publications` (
	`user_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`in_agenda` integer DEFAULT false NOT NULL,
	`followed` integer DEFAULT false NOT NULL,
	`saved_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	PRIMARY KEY(`user_id`, `publication_id`),
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_saved_user` ON `saved_publications` (`user_id`);
--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`user_id` text NOT NULL,
	`publication_id` text NOT NULL,
	`type` text NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`read` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`publication_id`) REFERENCES `publications`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_notifications_user_read` ON `notifications` (`user_id`,`read`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_notifications_unique` ON `notifications` (`user_id`,`publication_id`,`type`);
--> statement-breakpoint
CREATE TABLE `sync_state` (
	`source` text PRIMARY KEY NOT NULL,
	`synced_at` text NOT NULL,
	`item_count` integer DEFAULT 0 NOT NULL,
	`error` text
);
--> statement-breakpoint
PRAGMA optimize;
