import { desc, sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex, check, type AnySQLiteColumn } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(), name: text("name").notNull().default("Docente"), email: text("email"),
  level: text("level").notNull().default(""), area: text("area").notNull().default(""), subjects: text("subjects").notNull().default(""),
  junta: text("junta").notNull().default(""), roles: text("roles").notNull().default(""), department: text("department").notNull().default(""), locality: text("locality").notNull().default(""),
  shifts: text("shifts").notNull().default(""), wantsInterim: integer("wants_interim", { mode: "boolean" }).notNull().default(true),
  wantsSubstitute: integer("wants_substitute", { mode: "boolean" }).notNull().default(true), trainingInterests: text("training_interests").notNull().default(""),
  characters: text("characters").notNull().default(""), circuits: text("circuits").notNull().default(""), personalMatchThreshold: integer("personal_match_threshold").notNull().default(85),
  notifyNewTrainings: integer("notify_new_trainings", { mode: "boolean" }).notNull().default(false), trainingNotifyScope: text("training_notify_scope").notNull().default("relevant"),
  trainingMatchThreshold: integer("training_match_threshold").notNull().default(80),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const publicProfiles = sqliteTable("public_profiles", {
  userId: text("user_id").primaryKey(), displayName: text("display_name").notNull(),
  avatarId: text("avatar_id").notNull().default("avatar_01"), bio: text("bio").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(), source: text("source").notNull(), externalId: text("external_id").notNull(), kind: text("kind").notNull(),
  category: text("category").notNull(), title: text("title").notNull(), summary: text("summary").notNull().default(""),
  level: text("level").notNull().default(""), area: text("area").notNull().default(""), junta: text("junta").notNull().default(""),
  location: text("location").notNull().default(""), shift: text("shift").notNull().default(""), character: text("character").notNull().default(""),
  circuit: text("circuit").notNull().default("UNKNOWN"), sourceCircuitRaw: text("source_circuit_raw").notNull().default(""), circuitInferenceSource: text("circuit_inference_source").notNull().default("unknown"),
  startsAt: text("starts_at"), endsAt: text("ends_at"), status: text("status").notNull().default("vigente"), officialUrl: text("official_url").notNull(),
  metadata: text("metadata").notNull().default("{}"), contentHash: text("content_hash").notNull(), sourceUpdatedAt: text("source_updated_at"), firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`), lastSeenAt: text("last_seen_at").notNull().default(""), lastChangedAt: text("last_changed_at").notNull().default(""),
  sourcePublishedAt: text("source_published_at"), registrationOpenAt: text("registration_open_at"), registrationCloseAt: text("registration_close_at"), expiresAt: text("expires_at"),
  sourceStatus: text("source_status").notNull().default("UNKNOWN"), normalizedStatus: text("normalized_status").notNull().default("UNKNOWN"), removedAt: text("removed_at"), circuitConfidence: integer("circuit_confidence").notNull().default(0),
}, (table) => [index("idx_publications_kind_ends").on(table.kind, table.endsAt), index("idx_publications_source_external").on(table.source, table.externalId), index("idx_publications_lifecycle").on(table.normalizedStatus, table.kind, table.source)]);

export const externalPublicationEvents = sqliteTable("external_publication_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  contentHash: text("content_hash").notNull(),
  change: text("change", { enum: ["created", "updated"] }).notNull(),
  profileCursor: text("profile_cursor").notNull().default(""),
  status: text("status", { enum: ["pending", "done", "superseded"] }).notNull().default("pending"),
  leaseOwner: text("lease_owner"), leaseUntil: text("lease_until"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_external_publication_events_pending").on(table.status, table.leaseUntil, table.id)]);

export const externalEventSources = sqliteTable("external_event_sources", {
  source: text("source", { enum: ["Capacitación Docente", "SIME", "Padrones y Comunicados", "CeNET / INET", "INFoD / AulaS-TIC"] }).primaryKey(),
  enabledAt: text("enabled_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const savedPublications = sqliteTable("saved_publications", {
  userId: text("user_id").notNull(), publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  inAgenda: integer("in_agenda", { mode: "boolean" }).notNull().default(false), followed: integer("followed", { mode: "boolean" }).notNull().default(false),
  agendaAt: text("agenda_at"), agendaNotes: text("agenda_notes").notNull().default(""), agendaReminderAt: text("agenda_reminder_at"), agendaReminderNotified: integer("agenda_reminder_notified", { mode: "boolean" }).notNull().default(false),
  savedAt: text("saved_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [primaryKey({ columns: [table.userId, table.publicationId] }), index("idx_saved_user").on(table.userId)]);

export const notifications = sqliteTable("notifications", {
  id: integer("id").primaryKey({ autoIncrement: true }), userId: text("user_id").notNull(),
  publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }), type: text("type").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), read: integer("read", { mode: "boolean" }).notNull().default(false),
  dedupeKey: text("dedupe_key").notNull().default(""), scheduledAt: text("scheduled_at"), attemptedAt: text("attempted_at"), acceptedAt: text("accepted_at"), failureReason: text("failure_reason"),
}, (table) => [index("idx_notifications_user_read").on(table.userId, table.read), uniqueIndex("idx_notifications_dedupe").on(table.userId, table.dedupeKey).where(sql`${table.dedupeKey} <> ''`)]);

export const syncState = sqliteTable("sync_state", {
  source: text("source").primaryKey(), syncedAt: text("synced_at").notNull(), itemCount: integer("item_count").notNull().default(0), error: text("error"),
  lastAttemptAt: text("last_attempt_at"), lastSuccessfulSyncAt: text("last_successful_sync_at"), lastContentChangeAt: text("last_content_change_at"),
  recordsCreated: integer("records_created").notNull().default(0), recordsUpdated: integer("records_updated").notNull().default(0), recordsRemoved: integer("records_removed").notNull().default(0), recordsExpired: integer("records_expired").notNull().default(0),
  syncStatus: text("sync_status").notNull().default("UNKNOWN"), errorCode: text("error_code"), errorMessage: text("error_message"), parserVersion: text("parser_version").notNull().default("1"),
}, (table) => [index("idx_sync_state_status").on(table.syncStatus, table.lastSuccessfulSyncAt)]);

export const trainingReminders = sqliteTable("training_reminders", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), trainingId: text("training_id").notNull(), publicationId: text("publication_id").notNull(),
  opensAt: text("opens_at").notNull(), precision: text("precision").notNull(), advanceMinutes: integer("advance_minutes"), remindAt: text("remind_at").notNull(),
  notified: integer("notified", { mode: "boolean" }).notNull().default(false), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_training_reminders_user").on(table.userId), index("idx_training_reminders_due").on(table.remindAt, table.notified)]);

export const designationTracking = sqliteTable("designation_tracking", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), publicationId: text("publication_id").notNull().references(() => publications.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("GUARDADO"), role: text("role").notNull().default(""), subject: text("subject").notNull().default(""), school: text("school").notNull().default(""),
  address: text("address").notNull().default(""), locality: text("locality").notNull().default(""), appliedAt: text("applied_at"), appointmentAt: text("appointment_at"), shift: text("shift").notNull().default(""), board: text("board").notNull().default(""),
  documentation: text("documentation").notNull().default(""), orderNumber: text("order_number").notNull().default(""), notes: text("notes").notNull().default(""), officialUrl: text("official_url").notNull().default(""),
  reminderAt: text("reminder_at"), reminderNotified: integer("reminder_notified", { mode: "boolean" }).notNull().default(false), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("idx_designation_tracking_user").on(table.userId, table.appointmentAt), index("idx_designation_tracking_reminder").on(table.reminderAt, table.reminderNotified)]);

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
  designationExact: integer("designation_exact", { mode: "boolean" }).notNull().default(true), designationPartial: integer("designation_partial", { mode: "boolean" }).notNull().default(true), designationRoles: integer("designation_roles", { mode: "boolean" }).notNull().default(true),
  quietStart: text("quiet_start").notNull().default("22:00"), quietEnd: text("quiet_end").notNull().default("07:00"), timezone: text("timezone").notNull().default("America/Argentina/Buenos_Aires"), updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const pushDeliveries = sqliteTable("push_deliveries", {
  id: integer("id").primaryKey({ autoIncrement: true }), endpoint: text("endpoint").notNull(), notificationId: integer("notification_id").notNull(), eventKey: text("event_key").notNull(),
  status: text("status").notNull().default("pending"), attempts: integer("attempts").notNull().default(0), lastError: text("last_error"), sentAt: text("sent_at"), nextAttemptAt: text("next_attempt_at"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  scheduledAt: text("scheduled_at"), attemptedAt: text("attempted_at"), acceptedAt: text("accepted_at"), failureReason: text("failure_reason"),
}, (table) => [uniqueIndex("idx_push_deliveries_unique").on(table.endpoint, table.eventKey), index("idx_push_deliveries_retry").on(table.status, table.nextAttemptAt)]);

export const pushRateLimits = sqliteTable("push_rate_limits", {
  userBucket: text("user_bucket").primaryKey(), requestCount: integer("request_count").notNull().default(0), expiresAt: text("expires_at").notNull(),
});

export const installationCredentials = sqliteTable("installation_credentials", {
  deviceId: text("device_id").primaryKey(), secretHash: text("secret_hash").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

// Better Auth's "user" table is managed outside this Drizzle schema; its actor FKs live in 0021 SQL.
export const newsItems = sqliteTable("news_items", {
  id: text("id").primaryKey(),
  originPublicationId: text("origin_publication_id").references(() => publications.id, { onDelete: "set null" }),
  status: text("status", { enum: ["candidate", "approved", "published", "rejected", "archived"] }).notNull().default("candidate"),
  editorialTitle: text("editorial_title").notNull().default(""),
  editorialSummary: text("editorial_summary").notNull().default(""),
  editorialBody: text("editorial_body"),
  heroImageUrl: text("hero_image_url"),
  heroImageAlt: text("hero_image_alt"),
  heroImageCredit: text("hero_image_credit"),
  heroImageSourceUrl: text("hero_image_source_url"),
  heroImageRightsNote: text("hero_image_rights_note"),
  heroImageRightsUrl: text("hero_image_rights_url"),
  topic: text("topic"),
  relevance: text("relevance", { enum: ["informativa", "importante", "urgente"] }).notNull().default("informativa"),
  featured: integer("featured", { mode: "boolean" }).notNull().default(false),
  validFrom: text("valid_from"), validUntil: text("valid_until"),
  approvedAt: text("approved_at"), publishedAt: text("published_at"),
  createdByUserId: text("created_by_user_id"), approvedByUserId: text("approved_by_user_id"),
  replacedByNewsId: text("replaced_by_news_id").references((): AnySQLiteColumn => newsItems.id, { onDelete: "set null" }),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_news_items_origin").on(table.originPublicationId).where(sql`${table.originPublicationId} IS NOT NULL`),
  index("idx_news_items_status_updated").on(table.status, desc(table.updatedAt)),
  index("idx_news_items_public_window").on(table.validFrom, table.validUntil, desc(table.publishedAt)).where(sql`${table.status} = 'published'`),
  check("news_items_status_check", sql`${table.status} IN ('candidate', 'approved', 'published', 'rejected', 'archived')`),
  check("news_items_relevance_check", sql`${table.relevance} IN ('informativa', 'importante', 'urgente')`),
  check("news_items_featured_check", sql`${table.featured} IN (0, 1)`),
  check("news_items_image_url_length_check", sql`${table.heroImageUrl} IS NULL OR length(${table.heroImageUrl}) <= 2048`),
  check("news_items_image_alt_length_check", sql`${table.heroImageAlt} IS NULL OR length(${table.heroImageAlt}) <= 240`),
  check("news_items_image_credit_length_check", sql`${table.heroImageCredit} IS NULL OR length(${table.heroImageCredit}) <= 160`),
  check("news_items_image_source_length_check", sql`${table.heroImageSourceUrl} IS NULL OR length(${table.heroImageSourceUrl}) <= 2048`),
  check("news_items_image_rights_note_length_check", sql`${table.heroImageRightsNote} IS NULL OR length(${table.heroImageRightsNote}) <= 500`),
  check("news_items_image_rights_url_length_check", sql`${table.heroImageRightsUrl} IS NULL OR length(${table.heroImageRightsUrl}) <= 2048`),
  check("news_items_valid_from_check", sql`${table.validFrom} IS NULL OR (${table.validFrom} GLOB '????-??-??T??:??:??.???Z' AND strftime('%Y-%m-%dT%H:%M:%fZ', ${table.validFrom}) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', ${table.validFrom}) = ${table.validFrom})`),
  check("news_items_valid_until_check", sql`${table.validUntil} IS NULL OR (${table.validUntil} GLOB '????-??-??T??:??:??.???Z' AND strftime('%Y-%m-%dT%H:%M:%fZ', ${table.validUntil}) IS NOT NULL AND strftime('%Y-%m-%dT%H:%M:%fZ', ${table.validUntil}) = ${table.validUntil})`),
  check("news_items_window_check", sql`${table.validFrom} IS NULL OR ${table.validUntil} IS NULL OR ${table.validUntil} > ${table.validFrom}`),
  check("news_items_replacement_check", sql`${table.replacedByNewsId} IS NULL OR ${table.replacedByNewsId} <> ${table.id}`),
]);

export const newsSources = sqliteTable("news_sources", {
  id: text("id").primaryKey(), newsItemId: text("news_item_id").notNull().references(() => newsItems.id, { onDelete: "restrict" }),
  publicationId: text("publication_id").references(() => publications.id, { onDelete: "set null" }),
  sourceName: text("source_name").notNull(), sourceTitle: text("source_title").notNull(),
  url: text("url").notNull(), normalizedUrl: text("normalized_url").notNull(),
  sourceType: text("source_type", { enum: ["official", "public", "union", "media"] }).notNull(),
  isPrimary: integer("is_primary", { mode: "boolean" }).notNull().default(false),
  position: integer("position").notNull().default(0), sourcePublishedAt: text("source_published_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  uniqueIndex("idx_news_sources_primary").on(table.newsItemId).where(sql`${table.isPrimary} = 1`),
  uniqueIndex("idx_news_sources_publication").on(table.newsItemId, table.publicationId).where(sql`${table.publicationId} IS NOT NULL`),
  uniqueIndex("idx_news_sources_url").on(table.newsItemId, table.normalizedUrl),
  index("idx_news_sources_publication_lookup").on(table.publicationId).where(sql`${table.publicationId} IS NOT NULL`),
  index("idx_news_sources_url_lookup").on(table.normalizedUrl),
  check("news_sources_type_check", sql`${table.sourceType} IN ('official', 'public', 'union', 'media')`),
  check("news_sources_url_check", sql`${table.url} LIKE 'https://%' AND length(${table.url}) <= 2048`),
  check("news_sources_normalized_url_check", sql`${table.normalizedUrl} LIKE 'https://%' AND length(${table.normalizedUrl}) <= 2048`),
  check("news_sources_primary_check", sql`${table.isPrimary} IN (0, 1)`),
  check("news_sources_position_check", sql`${table.position} >= 0`),
]);

export const newsEvents = sqliteTable("news_events", {
  id: text("id").primaryKey(), newsItemId: text("news_item_id").notNull().references(() => newsItems.id, { onDelete: "restrict" }),
  actorUserId: text("actor_user_id"), actorKind: text("actor_kind", { enum: ["admin", "system"] }).notNull(),
  action: text("action", { enum: ["create_candidate", "edit", "approve", "publish", "reject", "archive", "reopen", "feature", "unfeature", "source_add", "source_remove"] }).notNull(),
  previousStatus: text("previous_status", { enum: ["candidate", "approved", "published", "rejected", "archived"] }),
  nextStatus: text("next_status", { enum: ["candidate", "approved", "published", "rejected", "archived"] }),
  details: text("details").notNull().default("{}"), createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  index("idx_news_events_item_created").on(table.newsItemId, desc(table.createdAt)),
  check("news_events_actor_kind_check", sql`${table.actorKind} IN ('admin', 'system')`),
  check("news_events_action_check", sql`${table.action} IN ('create_candidate', 'edit', 'approve', 'publish', 'reject', 'archive', 'reopen', 'feature', 'unfeature', 'source_add', 'source_remove')`),
  check("news_events_previous_status_check", sql`${table.previousStatus} IS NULL OR ${table.previousStatus} IN ('candidate', 'approved', 'published', 'rejected', 'archived')`),
  check("news_events_next_status_check", sql`${table.nextStatus} IS NULL OR ${table.nextStatus} IN ('candidate', 'approved', 'published', 'rejected', 'archived')`),
  check("news_events_details_check", sql`json_valid(${table.details}) AND length(${table.details}) <= 2048`),
]);
