import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import { isEligibleForPersonalizedHome, matchesProfile } from "./matching.ts";
import { parseTrainingMetadata } from "./training.ts";
import { circuitMatches, inferCircuit } from "./circuits.ts";

export type PushEnvironment = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
export type PushMessage = { title: string; body: string; tag: string; url: string };
export type StoredSubscription = PushSubscription & { userId: string; deviceId: string; userAgent: string };

export const UPSERT_PUSH_SUBSCRIPTION_SQL = `INSERT INTO push_subscriptions (endpoint, user_id, device_id, p256dh, auth, expiration_time, user_agent, active)
  VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, expiration_time=excluded.expiration_time,
    user_agent=excluded.user_agent, active=1, updated_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP
  WHERE push_subscriptions.user_id=excluded.user_id AND push_subscriptions.device_id=excluded.device_id`;

export interface NotificationProvider {
  send(subscription: PushSubscription, message: PushMessage): Promise<Response>;
}

export class WebPushProvider implements NotificationProvider {
  private vapid: VapidKeys;
  constructor(vapid: VapidKeys) { this.vapid = vapid; }

  async send(subscription: PushSubscription, message: PushMessage) {
    const request = await buildPushPayload({ data: JSON.stringify(message), options: { ttl: 86_400, urgency: "high" } }, subscription, this.vapid);
    return fetch(subscription.endpoint, request);
  }
}

const endpointHosts = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "web.push.apple.com", "notify.windows.com"];
export function validPushEndpoint(endpoint: string) {
  try {
    const url = new URL(endpoint);
    return url.protocol === "https:" && !url.username && !url.password && endpointHosts.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch { return false; }
}

export function validSubscription(value: unknown): value is PushSubscription {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PushSubscription>;
  return typeof item.endpoint === "string" && item.endpoint.length <= 2048 && validPushEndpoint(item.endpoint)
    && typeof item.keys?.p256dh === "string" && item.keys.p256dh.length >= 40 && item.keys.p256dh.length <= 256
    && typeof item.keys?.auth === "string" && item.keys.auth.length >= 8 && item.keys.auth.length <= 128;
}

function nextRecurringStart(value: string, recurrence: string) {
  const date = new Date(value);
  if (recurrence === "daily") date.setTime(date.getTime() + 86_400_000);
  else if (recurrence === "weekly") date.setTime(date.getTime() + 7 * 86_400_000);
  else if (recurrence === "monthly") {
    const day = date.getUTCDate();
    date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1);
    const lastDay = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
    date.setUTCDate(Math.min(day, lastDay));
  }
  return date.toISOString();
}

const minutes = (value: string) => { const match = /^(\d{2}):(\d{2})$/.exec(value); return match ? Number(match[1]) * 60 + Number(match[2]) : null; };
export function isQuietTime(date: Date, start: string, end: string, timezone: string) {
  const startMinute = minutes(start), endMinute = minutes(end);
  if (startMinute == null || endMinute == null || startMinute === endMinute) return false;
  let parts: Intl.DateTimeFormatPart[];
  try { parts = new Intl.DateTimeFormat("en", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date); }
  catch { return false; }
  const current = Number(parts.find((part) => part.type === "hour")?.value || 0) * 60 + Number(parts.find((part) => part.type === "minute")?.value || 0);
  return startMinute < endMinute ? current >= startMinute && current < endMinute : current >= startMinute || current < endMinute;
}

export function isPushNotificationDue(scheduledAt: string | null | undefined, now = new Date()) {
  if (!scheduledAt) return false;
  const timestamp = new Date(scheduledAt).getTime();
  return Number.isFinite(timestamp) && timestamp <= now.getTime();
}

export type PushCategory = "vacancies" | "trainings" | "commissions" | "reminders" | "date_changes" | "closing_soon" | "boards";
export function categoryForNotification(type: string): PushCategory {
  if (type === "AGENDA_RECORDATORIO") return "reminders";
  if (type === "VACANTE_NUEVA" || type.startsWith("DESIGNACION_")) return type === "DESIGNACION_RECORDATORIO" ? "reminders" : type === "DESIGNACION_CAMBIO" ? "date_changes" : "vacancies";
  if (type === "COMISION_NUEVA") return "commissions";
  if (["CAPACITACION_ABRE", "CAPACITACION_PROXIMA", "CAPACITACION_ABRE_MANANA", "CAPACITACION_ABRE_HOY", "CAPACITACION_ABIERTA"].includes(type)) return "reminders";
  if (type === "CIERRE_PROXIMO") return "closing_soon";
  if (["FECHA_IMPORTANTE", "FECHA_CAMBIADA"].includes(type)) return "date_changes";
  if (type.startsWith("PADRON_") || type.startsWith("COMUNICADO_")) return "boards";
  return "trainings";
}

export function notificationMessage(type: string, title: string): PushMessage {
  const copy: Record<string, [string, string]> = {
    VACANTE_NUEVA: ["Nueva designación compatible", title], DESIGNACION_NUEVA: ["Nueva designación para vos", title], DESIGNACION_EXACTA_GENERAL: ["Coincidencia exacta", title], DESIGNACION_EXACTA_CARGO: ["Nuevo cargo de interés", title], DESIGNACION_PARCIAL_GENERAL: ["Coincidencia parcial", title], DESIGNACION_PARCIAL_CARGO: ["Nuevo cargo de interés", title], DESIGNACION_CAMBIO: ["Cambió una designación", title], DESIGNACION_RECORDATORIO: ["Recordatorio de designación", title], AGENDA_RECORDATORIO: ["Recordatorio de Agenda", title], CAPACITACION_NUEVA: ["Nueva capacitación compatible", title], CAPACITACION_ACTUALIZADA: ["Se actualizó una capacitación", title], COMISION_NUEVA: ["Nueva comisión disponible", title], COMUNICADO_ACTUALIZADO: ["Se actualizó un comunicado", title],
    CAPACITACION_ABRE: ["Recordatorio de inscripción", `Revisá la apertura de ${title}`], CAPACITACION_PROXIMA: ["Inscripción próxima", title], CAPACITACION_ABRE_MANANA: ["La inscripción abre mañana", title],
    CAPACITACION_ABRE_HOY: ["La inscripción abre hoy", title], CAPACITACION_ABIERTA: ["Inscripción abierta", title], CIERRE_PROXIMO: ["Cierra pronto", title],
    FECHA_IMPORTANTE: ["Actualización de fecha", title], FECHA_CAMBIADA: ["Cambió una fecha", title], COMUNICADO_NUEVO: ["Nuevo comunicado", title], PADRON_NUEVO: ["Nuevo padrón", title], PADRON_ACTUALIZADO: ["Padrón actualizado", title],
  };
  const [pushTitle, body] = copy[type] || ["Novedad en DocenteTuc", title];
  return { title: pushTitle, body, tag: `${type}:${title}`.slice(0, 120), url: "/" };
}

type PublicationRow = { id: string; kind: string; title: string; summary: string; level: string; area: string; junta: string; location: string; shift: string; character: string; circuit?: string; source_circuit_raw?: string; starts_at: string | null; ends_at: string | null; status: string; metadata: string; normalized_status?: string };
type ProfileRow = Record<string, unknown> & { user_id: string };
const dayInTucuman = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(date);
export const PUSH_DELIVERY_BATCH_SIZE = 10;

function matchProfile(profile: ProfileRow) {
  return { level: String(profile.level || ""), area: String(profile.area || ""), subjects: String(profile.subjects || ""), junta: String(profile.junta || ""), roles: String(profile.roles || ""), department: String(profile.department || ""), locality: String(profile.locality || ""), shifts: String(profile.shifts || ""), characters: String(profile.characters || "").split(/[,;|]/).filter(Boolean), circuits: String(profile.circuits || "").split(/[,;|]/).filter(Boolean), personalMatchThreshold: Number(profile.personal_match_threshold) || 85, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: String(profile.training_interests || "") };
}

export function publicationFitsProfileCircuit(publication: Pick<PublicationRow, "circuit" | "source_circuit_raw" | "location">, profile: ProfileRow) {
  const circuits = String(profile.circuits || "").split(/[,;|]/).filter(Boolean);
  if (!circuits.length) return true;
  if (publication.circuit === "ALL") return true;
  const raw = publication.source_circuit_raw || "";
  const explicit = /^[iv]+$|^[1-5]$/i.test(publication.circuit || "") ? `Circuito ${publication.circuit}` : raw;
  const inference = inferCircuit({ explicit, locality: publication.location || raw });
  return circuitMatches(inference, circuits) !== false;
}

function trainingNotificationsEnabled(publication: PublicationRow, profile: ProfileRow) {
  if (!Boolean(profile.notify_new_trainings)) return false;
  if (!publicationFitsProfileCircuit(publication, profile)) return false;
  const fullProfile = matchProfile(profile), scope = String(profile.training_notify_scope || "relevant"), metadata = parseTrainingMetadata(publication.metadata);
  const matchPublication = metadata?.recipients ? { ...publication, recipients: metadata.recipients } : publication;
  if (scope === "all") return true;
  if (scope === "level") return matchesProfile(matchPublication, { level: fullProfile.level });
  if (scope === "area") return matchesProfile(matchPublication, { area: fullProfile.area, subjects: fullProfile.subjects });
  if (scope === "interests") return matchesProfile(matchPublication, { trainingInterests: fullProfile.trainingInterests });
  return isEligibleForPersonalizedHome(matchPublication, fullProfile);
}

export function scheduledNotificationTypes(publication: PublicationRow, profile: ProfileRow, saved: boolean, now = new Date()) {
  const events: string[] = [], metadata = publication.kind === "capacitacion" ? parseTrainingMetadata(publication.metadata) : null;
  if (publication.kind !== "capacitacion" || ["CLOSED", "EXPIRED", "REMOVED_FROM_SOURCE"].includes(String(publication.normalized_status || "").toUpperCase())) return events;
  if (!trainingNotificationsEnabled(publication, profile)) return events;
  if (!metadata || !["confirmed", "course_confirmed"].includes(String(metadata.dateStatus || "").toLowerCase())) return events;
  const closingAt = metadata?.registrationClosesAt || publication.ends_at;
  if (saved && closingAt) {
    const remaining = new Date(closingAt).getTime() - now.getTime();
    if (remaining > 0 && remaining <= 48 * 3_600_000) events.push("CIERRE_PROXIMO");
  }
  const opening = metadata?.registrationOpensAt;
  if (!opening) return events;
  const opensAt = new Date(opening), remaining = opensAt.getTime() - now.getTime(), openingDay = dayInTucuman(opensAt);
  const todayKey = dayInTucuman(now), tomorrowKey = dayInTucuman(new Date(now.getTime() + 86_400_000));
  if (remaining > 0 && remaining <= 7 * 86_400_000) events.push("CAPACITACION_PROXIMA");
  if (openingDay === tomorrowKey) events.push("CAPACITACION_ABRE_MANANA");
  if (openingDay === todayKey) events.push("CAPACITACION_ABRE_HOY");
  if (opensAt <= now && (!closingAt || new Date(closingAt) > now)) events.push("CAPACITACION_ABIERTA");
  return events;
}

export async function materializeScheduledNotifications(db: D1Database, now = new Date()) {
  let rowsWritten = 0;
  const count = (result: { meta?: { rows_written?: number } }) => { rowsWritten += Number(result.meta?.rows_written || 0); };
  count(await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) SELECT user_id, publication_id, 'CAPACITACION_ABRE', 'training-reminder:' || id || ':' || opens_at || ':' || COALESCE(advance_minutes,0), ? FROM training_reminders WHERE notified=0 AND datetime(remind_at)<=datetime(?)").bind(now.toISOString(), now.toISOString()).run());
  count(await db.prepare("UPDATE training_reminders SET notified=1, updated_at=CURRENT_TIMESTAMP WHERE notified=0 AND datetime(remind_at)<=datetime(?)").bind(now.toISOString()).run());
  count(await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) SELECT user_id, publication_id, 'DESIGNACION_RECORDATORIO', 'designation-reminder:' || id || ':' || reminder_at, ? FROM designation_tracking WHERE reminder_notified=0 AND reminder_at IS NOT NULL AND datetime(reminder_at)<=datetime(?)").bind(now.toISOString(), now.toISOString()).run());
  count(await db.prepare("UPDATE designation_tracking SET reminder_notified=1, updated_at=CURRENT_TIMESTAMP WHERE reminder_notified=0 AND reminder_at IS NOT NULL AND datetime(reminder_at)<=datetime(?)").bind(now.toISOString()).run());
  count(await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) SELECT user_id, publication_id, 'AGENDA_RECORDATORIO', 'agenda-reminder:' || user_id || ':' || publication_id || ':' || agenda_reminder_at, ? FROM saved_publications WHERE in_agenda=1 AND agenda_reminder_notified=0 AND agenda_reminder_at IS NOT NULL AND datetime(agenda_reminder_at)<=datetime(?)").bind(now.toISOString(), now.toISOString()).run());
  count(await db.prepare("UPDATE saved_publications SET agenda_reminder_notified=1 WHERE in_agenda=1 AND agenda_reminder_notified=0 AND agenda_reminder_at IS NOT NULL AND datetime(agenda_reminder_at)<=datetime(?)").bind(now.toISOString()).run());
  const dueEvents = await db.prepare("SELECT id, user_id, title, starts_at, recurrence, reminder_minutes FROM manual_events WHERE reminder_notified=0 AND reminder_at IS NOT NULL AND datetime(reminder_at)<=datetime(?) LIMIT 100").bind(now.toISOString()).all<{ id: string; user_id: string; title: string; starts_at: string; recurrence: string; reminder_minutes: number | null }>();
  for (const event of dueEvents.results) {
    count(await db.prepare("INSERT OR IGNORE INTO manual_event_push_queue (user_id, event_id, title, occurrence_at) VALUES (?, ?, ?, ?)").bind(event.user_id, event.id, event.title, event.starts_at).run());
    if (["daily", "weekly", "monthly"].includes(event.recurrence) && event.reminder_minutes != null) {
      const nextStarts = nextRecurringStart(event.starts_at, event.recurrence), nextReminder = new Date(new Date(nextStarts).getTime() - Number(event.reminder_minutes) * 60_000).toISOString();
      await db.prepare("UPDATE manual_events SET starts_at=?, reminder_at=?, reminder_notified=0, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(nextStarts, nextReminder, event.id, event.user_id).run();
    } else await db.prepare("UPDATE manual_events SET reminder_notified=1, updated_at=CURRENT_TIMESTAMP WHERE id=? AND user_id=?").bind(event.id, event.user_id).run();
  }

  const [profiles, publications] = await Promise.all([
    db.prepare("SELECT * FROM profiles WHERE notify_new_trainings=1").all<ProfileRow>(),
    db.prepare("SELECT id, kind, title, summary, level, area, junta, location, shift, character, circuit, source_circuit_raw, starts_at, ends_at, status, metadata, normalized_status FROM publications WHERE kind='capacitacion' AND normalized_status IN ('ACTIVE','UPCOMING') LIMIT 800").all<PublicationRow>(),
  ]);
  const upcomingTrainings = publications.results.filter((publication) => {
    const metadata = parseTrainingMetadata(publication.metadata);
    if (!metadata?.registrationOpensAt) return false;
    const opening = new Date(metadata.registrationOpensAt).getTime(), remaining = opening - now.getTime(), closing = metadata.registrationClosesAt || publication.ends_at;
    return (remaining > 0 && remaining <= 7 * 86_400_000) || (opening <= now.getTime() && (!closing || new Date(closing).getTime() > now.getTime()));
  });
  const statements: D1PreparedStatement[] = [];
  for (const profile of profiles.results) {
    const followed = await db.prepare("SELECT publication_id FROM saved_publications WHERE user_id=?").bind(profile.user_id).all<{ publication_id: string }>();
    const savedIds = new Set(followed.results.map((row) => row.publication_id));
    for (const publication of upcomingTrainings) {
      const events = scheduledNotificationTypes(publication, profile, savedIds.has(publication.id), now);
      const metadata = parseTrainingMetadata(publication.metadata), eventDate = metadata?.registrationOpensAt || metadata?.registrationClosesAt || publication.ends_at || "unknown-date";
      for (const type of events) {
        const dedupeKey = `automatic:${publication.id}:${type}:${eventDate}`.slice(0, 255);
        statements.push(db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) VALUES (?, ?, ?, ?, ?)").bind(profile.user_id, publication.id, type, dedupeKey, now.toISOString()));
      }
    }
  }
  for (let offset = 0; offset < statements.length; offset += 50) for (const result of await db.batch(statements.slice(offset, offset + 50))) count(result);
  return { considered: statements.length, rowsWritten };
}

type DeliveryRow = { notification_id: number; endpoint: string; user_id: string; p256dh: string; auth: string; expiration_time: number | null; type: string; title: string; publication_id: string; queued_at: string; scheduled_at: string | null; quiet_start: string; quiet_end: string; timezone: string; enabled: number; vacancies: number; trainings: number; commissions: number; reminders: number; date_changes: number; closing_soon: number; boards: number; designation_exact: number; designation_partial: number; designation_roles: number; attempts: number | null };

export async function dispatchPushNotifications(db: D1Database, environment: PushEnvironment, now = new Date()) {
  if (!environment.VAPID_PUBLIC_KEY || !environment.VAPID_PRIVATE_KEY || !environment.VAPID_SUBJECT) throw new Error("VAPID_NOT_CONFIGURED");
  const provider = new WebPushProvider({ publicKey: environment.VAPID_PUBLIC_KEY, privateKey: environment.VAPID_PRIVATE_KEY, subject: environment.VAPID_SUBJECT });
  const rows = await db.prepare(`SELECT n.id notification_id, n.user_id, n.publication_id, n.type, n.scheduled_at, COALESCE(n.scheduled_at,n.created_at) queued_at, p.title, s.endpoint, s.p256dh, s.auth, s.expiration_time,
    COALESCE(pref.enabled,1) enabled, COALESCE(pref.vacancies,1) vacancies, COALESCE(pref.trainings,1) trainings, COALESCE(pref.commissions,1) commissions,
    COALESCE(pref.reminders,1) reminders, COALESCE(pref.date_changes,1) date_changes, COALESCE(pref.closing_soon,1) closing_soon, COALESCE(pref.boards,0) boards,
    COALESCE(pref.designation_exact,1) designation_exact, COALESCE(pref.designation_partial,1) designation_partial, COALESCE(pref.designation_roles,1) designation_roles,
    COALESCE(pref.quiet_start,'22:00') quiet_start, COALESCE(pref.quiet_end,'07:00') quiet_end, COALESCE(pref.timezone,'America/Argentina/Buenos_Aires') timezone, d.attempts
    FROM notifications n JOIN publications p ON p.id=n.publication_id JOIN push_subscriptions s ON s.user_id=n.user_id AND s.active=1
    LEFT JOIN push_preferences pref ON pref.user_id=n.user_id LEFT JOIN push_deliveries d ON d.endpoint=s.endpoint AND d.event_key='notice:' || n.id
    WHERE n.scheduled_at IS NOT NULL AND datetime(n.scheduled_at)<=datetime(?) AND datetime(n.created_at)>=datetime(s.created_at)
      AND (d.id IS NULL OR (d.status='failed' AND d.attempts<3 AND (d.next_attempt_at IS NULL OR datetime(d.next_attempt_at)<=datetime(?))))
    ORDER BY n.scheduled_at LIMIT ${PUSH_DELIVERY_BATCH_SIZE}`).bind(now.toISOString(), now.toISOString()).all<DeliveryRow>();
  const eventRows = await db.prepare(`SELECT q.id notification_id, q.user_id, 'manual:' || q.event_id publication_id, 'AGENDA_RECORDATORIO' type, q.created_at queued_at, q.title,
    s.endpoint, s.p256dh, s.auth, s.expiration_time, COALESCE(pref.enabled,1) enabled, COALESCE(pref.vacancies,1) vacancies, COALESCE(pref.trainings,1) trainings,
    COALESCE(pref.commissions,1) commissions, COALESCE(pref.reminders,1) reminders, COALESCE(pref.date_changes,1) date_changes, COALESCE(pref.closing_soon,1) closing_soon,
    COALESCE(pref.boards,0) boards, COALESCE(pref.designation_exact,1) designation_exact, COALESCE(pref.designation_partial,1) designation_partial, COALESCE(pref.designation_roles,1) designation_roles,
    COALESCE(pref.quiet_start,'22:00') quiet_start, COALESCE(pref.quiet_end,'07:00') quiet_end, COALESCE(pref.timezone,'America/Argentina/Buenos_Aires') timezone, d.attempts
    FROM manual_event_push_queue q JOIN push_subscriptions s ON s.user_id=q.user_id AND s.active=1 LEFT JOIN push_preferences pref ON pref.user_id=q.user_id
    LEFT JOIN push_deliveries d ON d.endpoint=s.endpoint AND d.event_key='manual:' || q.id
    WHERE datetime(q.created_at)>=datetime(s.created_at) AND (d.id IS NULL OR (d.status='failed' AND d.attempts<3 AND (d.next_attempt_at IS NULL OR datetime(d.next_attempt_at)<=datetime(?))))
    ORDER BY q.created_at LIMIT ${PUSH_DELIVERY_BATCH_SIZE}`).bind(now.toISOString()).all<DeliveryRow>();
  let sent = 0, failed = 0, removed = 0, deferred = 0;
  const deliveries = [...rows.results, ...eventRows.results].filter((row) => isPushNotificationDue(row.scheduled_at, now) || row.publication_id.startsWith("manual:")).sort((a, b) => new Date(a.queued_at).getTime() - new Date(b.queued_at).getTime()).slice(0, PUSH_DELIVERY_BATCH_SIZE);
  for (const row of deliveries) {
    const category = categoryForNotification(row.type);
    const manualEvent = row.publication_id.startsWith("manual:"), eventKey = `${manualEvent ? "manual" : "notice"}:${row.notification_id}`, message = notificationMessage(row.type, row.title);
    const designationAllowed = !row.type.startsWith("DESIGNACION_") || row.type === "DESIGNACION_RECORDATORIO" || row.type === "DESIGNACION_CAMBIO" || (row.type.includes("EXACTA") && Boolean(row.designation_exact)) || (row.type.includes("PARCIAL") && Boolean(row.designation_partial)) || (row.type.endsWith("_CARGO") && Boolean(row.designation_roles));
    if (!row.enabled || !row[category] || !designationAllowed) {
      await db.prepare("INSERT OR IGNORE INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, scheduled_at, failure_reason) VALUES (?, ?, ?, 'skipped', 0, ?, ?)").bind(row.endpoint, row.notification_id, eventKey, row.queued_at, !row.enabled ? "PUSH_DISABLED" : "CATEGORY_DISABLED").run();
      continue;
    }
    if (isQuietTime(now, row.quiet_start, row.quiet_end, row.timezone)) { deferred++; continue; }
    message.url = manualEvent ? "/" : `/?publication=${encodeURIComponent(row.publication_id)}`;
    message.tag = eventKey;
    await db.prepare("UPDATE notifications SET attempted_at=?, failure_reason=NULL WHERE id=?").bind(now.toISOString(), row.notification_id).run();
    await db.prepare("INSERT OR IGNORE INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, scheduled_at, attempted_at) VALUES (?, ?, ?, 'pending', 0, ?, ?)").bind(row.endpoint, row.notification_id, eventKey, row.queued_at, now.toISOString()).run();
    try {
      const response = await provider.send({ endpoint: row.endpoint, expirationTime: row.expiration_time, keys: { p256dh: row.p256dh, auth: row.auth } }, message);
      if (response.ok) {
        await db.prepare("INSERT INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, sent_at, scheduled_at, attempted_at, accepted_at) VALUES (?, ?, ?, 'sent', 1, CURRENT_TIMESTAMP, ?, ?, ?) ON CONFLICT(endpoint,event_key) DO UPDATE SET status='sent', attempts=push_deliveries.attempts+1, sent_at=CURRENT_TIMESTAMP, attempted_at=excluded.attempted_at, accepted_at=excluded.accepted_at, failure_reason=NULL, last_error=NULL, next_attempt_at=NULL").bind(row.endpoint, row.notification_id, eventKey, row.queued_at, now.toISOString(), now.toISOString()).run();
        await db.prepare("UPDATE notifications SET accepted_at=?, failure_reason=NULL WHERE id=?").bind(now.toISOString(), row.notification_id).run(); sent++;
      } else if (response.status === 404 || response.status === 410) {
        await db.prepare("UPDATE push_subscriptions SET active=0, updated_at=CURRENT_TIMESTAMP WHERE endpoint=?").bind(row.endpoint).run(); removed++;
        await db.prepare("INSERT INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, last_error, scheduled_at, attempted_at, failure_reason) VALUES (?, ?, ?, 'removed', 1, ?, ?, ?, ?) ON CONFLICT(endpoint,event_key) DO UPDATE SET status='removed', attempts=push_deliveries.attempts+1, last_error=excluded.last_error, attempted_at=excluded.attempted_at, failure_reason=excluded.failure_reason").bind(row.endpoint, row.notification_id, eventKey, `PUSH_${response.status}`, row.queued_at, now.toISOString(), `PUSH_${response.status}`).run();
        await db.prepare("UPDATE notifications SET failure_reason=? WHERE id=?").bind(`PUSH_${response.status}`, row.notification_id).run();
      } else throw new Error(`PUSH_${response.status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 180) : "PUSH_FAILED";
      await db.prepare("INSERT INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, last_error, next_attempt_at, scheduled_at, attempted_at, failure_reason) VALUES (?, ?, ?, 'failed', 1, ?, datetime('now','+10 minutes'), ?, ?, ?) ON CONFLICT(endpoint,event_key) DO UPDATE SET status='failed', attempts=push_deliveries.attempts+1, last_error=excluded.last_error, next_attempt_at=excluded.next_attempt_at, attempted_at=excluded.attempted_at, failure_reason=excluded.failure_reason").bind(row.endpoint, row.notification_id, eventKey, reason, row.queued_at, now.toISOString(), reason).run();
      await db.prepare("UPDATE notifications SET failure_reason=? WHERE id=?").bind(reason, row.notification_id).run(); failed++;
    }
  }
  return { considered: deliveries.length, sent, failed, removed, deferred };
}

export class NotificationService {
  constructor(privateDb: D1Database, privateEnvironment: PushEnvironment) { this.db = privateDb; this.environment = privateEnvironment; }
  private db: D1Database;
  private environment: PushEnvironment;
  async process(now = new Date()) {
    const materialized = await materializeScheduledNotifications(this.db, now);
    const delivery = await dispatchPushNotifications(this.db, this.environment, now);
    return { materialized, delivery };
  }
}
