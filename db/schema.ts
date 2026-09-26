import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const profiles = sqliteTable("profiles", {
  userId: text("user_id").primaryKey(), name: text("name").notNull().default("Docente"), email: text("email"),
  level: text("level").notNull().default(""), area: text("area").notNull().default(""), subjects: text("subjects").notNull().default(""),
  junta: text("junta").notNull().default(""), department: text("department").notNull().default(""), locality: text("locality").notNull().default(""),
  shifts: text("shifts").notNull().default(""), wantsInterim: integer("wants_interim", { mode: "boolean" }).notNull().default(true),
  wantsSubstitute: integer("wants_substitute", { mode: "boolean" }).notNull().default(true), trainingInterests: text("training_interests").notNull().default(""),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const publications = sqliteTable("publications", {
  id: text("id").primaryKey(), source: text("source").notNull(), externalId: text("external_id").notNull(), kind: text("kind").notNull(),
  category: text("category").notNull(), title: text("title").notNull(), summary: text("summary").notNull().default(""),
  level: text("level").notNull().default(""), area: text("area").notNull().default(""), junta: text("junta").notNull().default(""),
  location: text("location").notNull().default(""), shift: text("shift").notNull().default(""), character: text("character").notNull().default(""),
  startsAt: text("starts_at"), endsAt: text("ends_at"), status: text("status").notNull().default("vigente"), officialUrl: text("official_url").notNull(),
  contentHash: text("content_hash").notNull(), sourceUpdatedAt: text("source_updated_at"), firstSeenAt: text("first_seen_at").notNull().default(sql`CURRENT_TIMESTAMP`),
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
