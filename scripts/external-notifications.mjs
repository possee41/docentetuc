// Opt-in, replay-safe materialization of publication notices outside Workers.
// One page of profiles and at most five already-persisted publications per step.
import { randomUUID } from "node:crypto";
import { circuitMatches, inferCircuit } from "../lib/circuits.ts";
import { designationRoleFromTitle, isEligibleForPersonalizedHome, matchesProfile, profileMatch } from "../lib/matching.ts";
import { notificationDedupeKey } from "../lib/notification-events.ts";
import { officialMetadata } from "../lib/official-publication.ts";
import { parseTrainingMetadata } from "../lib/training.ts";
import { registrationState } from "../lib/home-dashboard.ts";
import { dispatchPushNotifications } from "../lib/push.ts";
import { materializeExternalReminderBatch } from "./external-reminders.mjs";

const profileOf = (row) => ({
  level: String(row.level || ""), area: String(row.area || ""), subjects: String(row.subjects || ""),
  junta: String(row.junta || ""), roles: String(row.roles || ""), department: String(row.department || ""),
  locality: String(row.locality || ""), shifts: String(row.shifts || ""),
  characters: String(row.characters || "").split(/[,;|]/).filter(Boolean),
  circuits: String(row.circuits || "").split(/[,;|]/).filter(Boolean),
  personalMatchThreshold: Number(row.personal_match_threshold) || 85,
  wantsInterim: Boolean(row.wants_interim), wantsSubstitute: Boolean(row.wants_substitute),
  trainingInterests: String(row.training_interests || ""),
});

function matches(row, profile, now) {
  const wanted = profileOf(profile);
  if (wanted.circuits.length) {
    const circuit = row.circuit === "ALL" ? "todos los circuitos" :
      /^[iv]+$|^[1-5]$/i.test(row.circuit || "") ? `Circuito ${row.circuit}` : row.source_circuit_raw || "";
    if (circuitMatches(inferCircuit({ explicit: circuit, locality: row.location || row.source_circuit_raw || "" }), wanted.circuits) === false) return false;
  }
  const item = { ...row, sourceCircuitRaw: row.source_circuit_raw || "" };
  if (row.kind === "vacante") return isEligibleForPersonalizedHome({ ...item, role: designationRoleFromTitle(row.title) }, wanted);
  if (row.kind !== "capacitacion") return matchesProfile(item, wanted);
  if (!profile.notify_new_trainings) return false;
  const metadata = parseTrainingMetadata(row.metadata);
  if (metadata?.entity === "commission" && metadata.availablePreCapacity === 0) return false;
  const matchItem = metadata?.recipients ? { ...item, recipients: metadata.recipients } : item;
  const scope = String(profile.training_notify_scope || "relevant");
  if (scope === "all") return true;
  if (scope === "level") return matchesProfile(matchItem, { level: wanted.level });
  if (scope === "area") return matchesProfile(matchItem, { area: wanted.area, subjects: wanted.subjects });
  if (scope === "interests") return matchesProfile(matchItem, { trainingInterests: wanted.trainingInterests });
  const state = registrationState(metadata?.registrationOpensAt, metadata?.registrationClosesAt, now);
  return ["today", "tomorrow", "two-three", "four-seven", "eight-fourteen"].includes(state) &&
    isEligibleForPersonalizedHome(matchItem, wanted);
}

function noticeType(row, profile, change) {
  const official = officialMetadata(row), metadata = row.kind === "capacitacion" ? parseTrainingMetadata(row.metadata) : null;
  if (official?.entity === "event") return change === "updated" ? "FECHA_CAMBIADA" : "FECHA_IMPORTANTE";
  if (change === "updated") return row.kind === "junta" ? row.category === "Comunicados" ? "COMUNICADO_ACTUALIZADO" : "PADRON_ACTUALIZADO" :
    row.kind === "vacante" ? "DESIGNACION_CAMBIO" : "CAPACITACION_ACTUALIZADA";
  if (row.kind === "vacante") {
    const match = profileMatch({ ...row, role: designationRoleFromTitle(row.title) }, profileOf(profile));
    return `DESIGNACION_${match.status === "exact" ? "EXACTA" : "PARCIAL"}_${match.criteria.some((criterion) => criterion.key === "role" && criterion.matched) ? "CARGO" : "GENERAL"}`;
  }
  if (metadata?.entity === "commission") return "COMISION_NUEVA";
  if (row.kind === "capacitacion") return "CAPACITACION_NUEVA";
  return row.category === "Comunicados" ? "COMUNICADO_NUEVO" : "PADRON_NUEVO";
}

export async function materializeExternalNoticePage(db, { events, cursor = "", limit = 25, now = new Date() }) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 5 ||
      !events.every((event) => typeof event.id === "string" && event.id.length <= 200 &&
        /^[a-f0-9]{64}$/.test(event.contentHash) && ["created", "updated"].includes(event.change)) ||
      new Set(events.map((event) => event.id)).size !== events.length ||
      typeof cursor !== "string" || cursor.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 25 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("EXTERNAL_NOTICES_INVALID");

  const rows = [];
  for (const event of events) {
    const row = await db.prepare("SELECT * FROM publications WHERE id=? AND content_hash=?").bind(event.id, event.contentHash).first();
    if (!row) throw new Error("EXTERNAL_NOTICE_PUBLICATION_CHANGED");
    const official = officialMetadata(row);
    if (!["ACTIVE", "UPCOMING"].includes(row.normalized_status) || row.removed_at || row.kind === "informacion" ||
        row.id.startsWith("drive:") || (official && (official.canonicalId || official.entity === "reference" ||
          official.candidateIds?.length || official.topics.includes("CLASIFICACION_PENDIENTE")))) continue;
    rows.push({ row, event });
  }
  if (!rows.length) return { profiles: 0, considered: 0, inserted: 0, nextCursor: null };
  const page = await db.prepare("SELECT * FROM profiles WHERE user_id>? ORDER BY user_id LIMIT ?").bind(cursor, limit).all();
  const profiles = page.results || [];
  let considered = 0, inserted = 0;
  for (const profile of profiles) for (const { row, event } of rows) {
    if (!matches(row, profile, now)) continue;
    const type = noticeType(row, profile, event.change);
    const metadata = row.kind === "capacitacion" ? parseTrainingMetadata(row.metadata) : null;
    const date = metadata?.registrationOpensAt || metadata?.registrationClosesAt || row.ends_at || row.starts_at || row.source_updated_at || row.content_hash;
    const identity = event.change === "updated" ? `change:${row.content_hash}` : `date:${date}`;
    const key = notificationDedupeKey(row.id, type, identity);
    const result = await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) VALUES (?, ?, ?, ?, ?)")
      .bind(profile.user_id, row.id, type, key, now.toISOString()).run();
    considered++;
    inserted += Number(result.meta?.rows_written || 0) > 0 ? 1 : 0;
  }
  return { profiles: profiles.length, considered, inserted, nextCursor: profiles.length === limit ? profiles.at(-1).user_id : null };
}

// The SQLite triggers enqueue events atomically with publication writes. Claim
// one event, materialize one profile page, then advance its cursor. A crash
// before the cursor write replays harmlessly through notifications.dedupe_key.
export async function materializeNextPersistedNoticePage(db, { now = new Date(), limit = 25 } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 25)
    throw new Error("EXTERNAL_NOTICES_INVALID");
  const instant = now.toISOString();
  const event = await db.prepare(`SELECT id,publication_id,content_hash,change,profile_cursor
    FROM external_publication_events WHERE status='pending' AND (lease_until IS NULL OR lease_until<=?)
    ORDER BY id LIMIT 1`).bind(instant).first();
  if (!event) return { eventId: null, profiles: 0, considered: 0, inserted: 0, nextCursor: null };
  const owner = randomUUID(), leaseUntil = new Date(now.getTime() + 120_000).toISOString();
  const claimed = await db.prepare(`UPDATE external_publication_events SET lease_owner=?,lease_until=?,updated_at=?
    WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<=?)`)
    .bind(owner, leaseUntil, instant, event.id, instant).run();
  if (!Number(claimed.meta?.rows_written)) return { eventId: null, profiles: 0, considered: 0, inserted: 0, nextCursor: null };

  const publication = await db.prepare("SELECT content_hash FROM publications WHERE id=?").bind(event.publication_id).first();
  if (!publication || publication.content_hash !== event.content_hash) {
    await db.prepare(`UPDATE external_publication_events SET status='superseded',lease_owner=NULL,lease_until=NULL,updated_at=?
      WHERE id=? AND lease_owner=?`).bind(instant, event.id, owner).run();
    return { eventId: event.id, superseded: true, profiles: 0, considered: 0, inserted: 0, nextCursor: null };
  }

  const page = await materializeExternalNoticePage(db, { events: [{ id: event.publication_id,
    contentHash: event.content_hash, change: event.change }], cursor: event.profile_cursor, limit, now });
  const advanced = await db.prepare(`UPDATE external_publication_events
    SET profile_cursor=?,status=?,lease_owner=NULL,lease_until=NULL,updated_at=?
    WHERE id=? AND lease_owner=? AND profile_cursor=? AND status='pending'`)
    .bind(page.nextCursor || event.profile_cursor, page.nextCursor ? "pending" : "done",
      instant, event.id, owner, event.profile_cursor).run();
  if (!Number(advanced.meta?.rows_written)) throw new Error("EXTERNAL_NOTICE_LEASE_LOST");
  return { eventId: event.id, ...page };
}

// One bounded, replay-safe step; the caller supplies the provider explicitly.
/** @param {D1Database} db
 * @param {{events?: {id: string, contentHash: string, change: string}[], cursor?: string, now?: Date,
 *   provider?: import("../lib/push.ts").NotificationProvider, environment?: import("../lib/push.ts").PushEnvironment}} options */
export async function runExternalNotificationStep(db, { events = [], cursor = "", now = new Date(), provider, environment } = {}) {
  if (!provider || typeof provider.send !== "function") throw new Error("PUSH_PROVIDER_REQUIRED");
  const notices = events.length ? await materializeExternalNoticePage(db, { events, cursor, now }) :
    await materializeNextPersistedNoticePage(db, { now });
  const reminders = await materializeExternalReminderBatch(db, { now });
  const delivery = await dispatchPushNotifications(db, environment || {}, now, provider);
  return { notices, reminders, delivery };
}
