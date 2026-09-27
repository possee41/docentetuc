import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(), name: text("name").notNull().default("Docente"), email: text("email"),
  level: text("level").notNull().default(""), area: text("area").notNull().default(""), subjects: text("subjects").notNull().default(""),
  junta: text("junta").notNull().default(""), department: text("department").notNull().default(""), locality: text("locality").notNull().default(""),
  shifts: text("shifts").notNull().default(""), wantsInterim: integer("wants_interim", { mode: "boolean" }).notNull().default(true),
  wantsSubstitute: integer("wants_substitute", { mode: "boolean" }).notNull().default(true), trainingInterests: text("training_interests").notNull().default(""),
  notifyNewTrainings: integer("notify_new_trainings", { mode: "boolean" }).notNull().default(false), trainingNotifyScope: text("training_notify_scope").notNull().default("relevant"),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(), source: text("source").notNull(), externalId: text("external_id").notNull(), kind: text("kind").notNull(),
  category: text("category").notNull(), title: text("title").notNull(), summary: text("summary").notNull().default(""),
  level: text("level").notNull().default(""), area: text("area").notNull().default(""), junta: text("junta").notNull().default(""),
  location: text("location").notNull().default(""), shift: text("shift").notNull().default(""), character: text("character").notNull().default(""),
  startsAt: text("starts_at"), endsAt: text("ends_at"), status: text("status").notNull().default("vigente"), officialUrl: text("official_url").notNull(),
  metadata: text("metadata").notNull().default("{}"), contentHash: text("content_hash").notNull(), sourceUpdatedAt: text("source_updated_at"), firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_publications_kind_ends").on(table.kind, table.endsAt), index("idx_publications_source_external").on(table.source, table.externalId)]);

export const savedPublications = sqliteTable("saved_publications", {
  userId: text("user_id").notNull(), publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  inAgenda: integer("in_agenda", { mode: "boolean" }).notNull().default(false), followed: integer("followed", { mode: "boolean" }).notNull().default(false),
  savedAt: text("saved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.userId, table.publicationId] }), index("idx_saved_user").on(table.userId)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }), userId: text("user_id").notNull(),
  publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }), type: text("type").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), read: integer("read", { mode: "boolean" }).notNull().default(false),
}, (table) => [index("idx_notifications_user_read").on(table.userId, table.read), uniqueIndex("idx_notifications_unique").on(table.userId, table.publicationId, table.type)]);

export const syncState = sqliteTable("sync_state", {
  source: text("source").primaryKey(), syncedAt: text("synced_at").notNull(), itemCount: integer("item_count").notNull().default(0), error: text("error"),
});

export const trainingReminders = sqliteTable("training_reminders", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), trainingId: text("training_id").notNull(), publicationId: text("publication_id").notNull(),
  opensAt: text("opens_at").notNull(), precision: text("precision").notNull(), advanceMinutes: integer("advance_minutes"), remindAt: text("remind_at").notNull(),
  notified: integer("notified", { mode: "boolean" }).notNull().default(false), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_training_reminders_user").on(table.userId), index("idx_training_reminders_due").on(table.remindAt, table.notified)]);

export const aiRateLimits = sqliteTable("ai_rate_limits", {
  userBucket: text("user_bucket").primaryKey(), requestCount: integer("request_count").notNull().default(0), expiresAt: text("expires_at").notNull(),
});

export const pushSubscriptions = sqliteTable("push_subscriptions", {
  endpoint: text("endpoint").primaryKey(), userId: text("user_id").notNull(), deviceId: text("device_id").notNull(), p256dh: text("p256dh").notNull(), auth: text("auth").notNull(),
  expirationTime: integer("expiration_time"), userAgent: text("user_agent").notNull().default(""), active: integer("active", { mode: "boolean" }).notNull().default(true),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`), lastSeenAt: text("last_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_push_subscriptions_user").on(table.userId, table.active)]);

export const pushPreferences = sqliteTable("push_preferences", {
  userId: text("user_id").primaryKey(), enabled: integer("enabled", { mode: "boolean" }).notNull().default(true), vacancies: integer("vacancies", { mode: "boolean" }).notNull().default(true),
  trainings: integer("trainings", { mode: "boolean" }).notNull().default(true), commissions: integer("commissions", { mode: "boolean" }).notNull().default(true), reminders: integer("reminders", { mode: "boolean" }).notNull().default(true),
  dateChanges: integer("date_changes", { mode: "boolean" }).notNull().default(true), closingSoon: integer("closing_soon", { mode: "boolean" }).notNull().default(true), boards: integer("boards", { mode: "boolean" }).notNull().default(false),
  quietStart: text("quiet_start").notNull().default("22:00"), quietEnd: text("quiet_end").notNull().default("07:00"), timezone: text("timezone").notNull().default("America/Argentina/Buenos_Aires"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pushDeliveries = sqliteTable("push_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }), endpoint: text("endpoint").notNull(), notificationId: integer("notification_id").notNull(), eventKey: text("event_key").notNull(),
  status: text("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0), lastError: text("last_error"), sentAt: text("sent_at"), nextAttemptAt: text("next_attempt_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [uniqueIndex("idx_push_deliveries_unique").on(table.endpoint, table.eventKey), index("idx_push_deliveries_retry").on(table.status, table.nextAttemptAt)]);

export const pushRateLimits = sqliteTable("push_rate_limits", {
  userBucket: text("user_bucket").primaryKey(), requestCount: integer("request_count").notNull().default(0), expiresAt: text("expires_at").notNull(),
});
