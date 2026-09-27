import { buildPushPayload, type PushSubscription, type VapidKeys } from "@block65/webcrypto-web-push";
import { matchesProfile } from "./matching.ts";
import { parseTrainingMetadata } from "./training.ts";

export type PushEnvironment = { VAPID_PUBLIC_KEY?: string; VAPID_PRIVATE_KEY?: string; VAPID_SUBJECT?: string };
export type PushMessage = { title: string; body: string; tag: string; url: string };
export type StoredSubscription = PushSubscription & { userId: string; deviceId: string; userAgent: string };

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

export type PushCategory = "vacancies" | "trainings" | "commissions" | "reminders" | "date_changes" | "closing_soon" | "boards";
export function categoryForNotification(type: string): PushCategory {
  if (type === "VACANTE_NUEVA") return "vacancies";
  if (type === "COMISION_NUEVA") return "commissions";
  if (["CAPACITACION_ABRE", "CAPACITACION_PROXIMA", "CAPACITACION_ABRE_MANANA", "CAPACITACION_ABRE_HOY", "CAPACITACION_ABIERTA"].includes(type)) return "reminders";
  if (type === "CIERRE_PROXIMO") return "closing_soon";
  if (["FECHA_IMPORTANTE", "FECHA_CAMBIADA"].includes(type)) return "date_changes";
  if (type.startsWith("PADRON_") || type === "COMUNICADO_NUEVO") return "boards";
  return "trainings";
}

export function notificationMessage(type: string, title: string): PushMessage {
  const copy: Record<string, [string, string]> = {
    VACANTE_NUEVA: ["Nueva vacante compatible", title], CAPACITACION_NUEVA: ["Nueva capacitación compatible", title], COMISION_NUEVA: ["Nueva comisión disponible", title],
    CAPACITACION_ABRE: ["Recordatorio de inscripción", `Revisá la apertura de ${title}`], CAPACITACION_PROXIMA: ["Inscripción próxima", title], CAPACITACION_ABRE_MANANA: ["La inscripción abre mañana", title],
    CAPACITACION_ABRE_HOY: ["La inscripción abre hoy", title], CAPACITACION_ABIERTA: ["Inscripción abierta", title], CIERRE_PROXIMO: ["Cierra pronto", title],
    FECHA_IMPORTANTE: ["Actualización de fecha", title], FECHA_CAMBIADA: ["Cambió una fecha", title], COMUNICADO_NUEVO: ["Nuevo comunicado", title], PADRON_NUEVO: ["Nuevo padrón", title], PADRON_ACTUALIZADO: ["Padrón actualizado", title],
  };
  const [pushTitle, body] = copy[type] || ["Novedad en DocenteTuc", title];
  return { title: pushTitle, body, tag: `${type}:${title}`.slice(0, 120), url: "/" };
}

type PublicationRow = { id: string; kind: string; title: string; summary: string; level: string; area: string; junta: string; location: string; shift: string; character: string; starts_at: string | null; ends_at: string | null; status: string; metadata: string };
type ProfileRow = Record<string, unknown> & { user_id: string };
const dayInTucuman = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(date);

function matches(publication: PublicationRow, profile: ProfileRow) {
  return matchesProfile(publication, { level: String(profile.level || ""), area: String(profile.area || ""), subjects: String(profile.subjects || ""), junta: String(profile.junta || ""), department: String(profile.department || ""), locality: String(profile.locality || ""), shifts: String(profile.shifts || ""), wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: String(profile.training_interests || "") });
}

export async function materializeScheduledNotifications(db: D1Database, now = new Date()) {
  await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type) SELECT user_id, publication_id, 'CAPACITACION_ABRE' FROM training_reminders WHERE notified=0 AND datetime(remind_at)<=datetime(?)").bind(now.toISOString()).run();
  await db.prepare("UPDATE training_reminders SET notified=1, updated_at=CURRENT_TIMESTAMP WHERE notified=0 AND datetime(remind_at)<=datetime(?)").bind(now.toISOString()).run();

  const [profiles, publications] = await Promise.all([
    db.prepare("SELECT * FROM profiles").all<ProfileRow>(),
    db.prepare("SELECT id, kind, title, summary, level, area, junta, location, shift, character, starts_at, ends_at, status, metadata FROM publications WHERE kind IN ('vacante','capacitacion') AND status NOT IN ('cerrada','finalizada') LIMIT 800").all<PublicationRow>(),
  ]);
  const tomorrow = new Date(now.getTime() + 86_400_000), todayKey = dayInTucuman(now), tomorrowKey = dayInTucuman(tomorrow), statements: D1PreparedStatement[] = [];
  for (const profile of profiles.results) for (const publication of publications.results) {
    if (!matches(publication, profile)) continue;
    const events: string[] = [], closingAt = publication.kind === "capacitacion" ? parseTrainingMetadata(publication.metadata)?.registrationClosesAt : publication.ends_at;
    if (closingAt) { const remaining = new Date(closingAt).getTime() - now.getTime(); if (remaining > 0 && remaining <= 48 * 3_600_000) events.push("CIERRE_PROXIMO"); }
    if (publication.kind === "capacitacion") {
      const opening = parseTrainingMetadata(publication.metadata)?.registrationOpensAt;
      if (opening) {
        const opensAt = new Date(opening), remaining = opensAt.getTime() - now.getTime(), openingDay = dayInTucuman(opensAt);
        if (remaining > 0 && remaining <= 7 * 86_400_000) events.push("CAPACITACION_PROXIMA");
        if (openingDay === tomorrowKey) events.push("CAPACITACION_ABRE_MANANA");
        if (openingDay === todayKey) events.push("CAPACITACION_ABRE_HOY");
        if (opensAt <= now && (!closingAt || new Date(closingAt) > now)) events.push("CAPACITACION_ABIERTA");
      }
    }
    for (const type of events) statements.push(db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type) VALUES (?, ?, ?)").bind(profile.user_id, publication.id, type));
  }
  for (let offset = 0; offset < statements.length; offset += 50) await db.batch(statements.slice(offset, offset + 50));
  return statements.length;
}

type DeliveryRow = { notification_id: number; endpoint: string; user_id: string; p256dh: string; auth: string; expiration_time: number | null; type: string; title: string; publication_id: string; quiet_start: string; quiet_end: string; timezone: string; enabled: number; vacancies: number; trainings: number; commissions: number; reminders: number; date_changes: number; closing_soon: number; boards: number; attempts: number | null };

export async function dispatchPushNotifications(db: D1Database, environment: PushEnvironment, now = new Date()) {
  if (!environment.VAPID_PUBLIC_KEY || !environment.VAPID_PRIVATE_KEY || !environment.VAPID_SUBJECT) throw new Error("VAPID_NOT_CONFIGURED");
  const provider = new WebPushProvider({ publicKey: environment.VAPID_PUBLIC_KEY, privateKey: environment.VAPID_PRIVATE_KEY, subject: environment.VAPID_SUBJECT });
  const rows = await db.prepare(`SELECT n.id notification_id, n.user_id, n.publication_id, n.type, p.title, s.endpoint, s.p256dh, s.auth, s.expiration_time,
    COALESCE(pref.enabled,1) enabled, COALESCE(pref.vacancies,1) vacancies, COALESCE(pref.trainings,1) trainings, COALESCE(pref.commissions,1) commissions,
    COALESCE(pref.reminders,1) reminders, COALESCE(pref.date_changes,1) date_changes, COALESCE(pref.closing_soon,1) closing_soon, COALESCE(pref.boards,0) boards,
    COALESCE(pref.quiet_start,'22:00') quiet_start, COALESCE(pref.quiet_end,'07:00') quiet_end, COALESCE(pref.timezone,'America/Argentina/Buenos_Aires') timezone, d.attempts
    FROM notifications n JOIN publications p ON p.id=n.publication_id JOIN push_subscriptions s ON s.user_id=n.user_id AND s.active=1
    LEFT JOIN push_preferences pref ON pref.user_id=n.user_id LEFT JOIN push_deliveries d ON d.endpoint=s.endpoint AND d.event_key='notice:' || n.id
    WHERE datetime(n.created_at)>=datetime(s.created_at) AND (d.id IS NULL OR (d.status='failed' AND d.attempts<3 AND (d.next_attempt_at IS NULL OR datetime(d.next_attempt_at)<=datetime(?))))
    ORDER BY n.created_at LIMIT 100`).bind(now.toISOString()).all<DeliveryRow>();
  let sent = 0, failed = 0, removed = 0, deferred = 0;
  for (const row of rows.results) {
    const category = categoryForNotification(row.type);
    const eventKey = `notice:${row.notification_id}`, message = notificationMessage(row.type, row.title);
    if (!row.enabled || !row[category]) {
      await db.prepare("INSERT OR IGNORE INTO push_deliveries (endpoint, notification_id, event_key, status, attempts) VALUES (?, ?, ?, 'skipped', 0)").bind(row.endpoint, row.notification_id, eventKey).run();
      continue;
    }
    if (isQuietTime(now, row.quiet_start, row.quiet_end, row.timezone)) { deferred++; continue; }
    message.url = `/?publication=${encodeURIComponent(row.publication_id)}`;
    message.tag = eventKey;
    try {
      const response = await provider.send({ endpoint: row.endpoint, expirationTime: row.expiration_time, keys: { p256dh: row.p256dh, auth: row.auth } }, message);
      if (response.ok) {
        await db.prepare("INSERT INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, sent_at) VALUES (?, ?, ?, 'sent', 1, CURRENT_TIMESTAMP) ON CONFLICT(endpoint,event_key) DO UPDATE SET status='sent', attempts=push_deliveries.attempts+1, sent_at=CURRENT_TIMESTAMP, last_error=NULL, next_attempt_at=NULL").bind(row.endpoint, row.notification_id, eventKey).run(); sent++;
      } else if (response.status === 404 || response.status === 410) {
        await db.prepare("UPDATE push_subscriptions SET active=0, updated_at=CURRENT_TIMESTAMP WHERE endpoint=?").bind(row.endpoint).run(); removed++;
      } else throw new Error(`PUSH_${response.status}`);
    } catch (error) {
      const reason = error instanceof Error ? error.message.slice(0, 180) : "PUSH_FAILED";
      await db.prepare("INSERT INTO push_deliveries (endpoint, notification_id, event_key, status, attempts, last_error, next_attempt_at) VALUES (?, ?, ?, 'failed', 1, ?, datetime('now','+10 minutes')) ON CONFLICT(endpoint,event_key) DO UPDATE SET status='failed', attempts=push_deliveries.attempts+1, last_error=excluded.last_error, next_attempt_at=excluded.next_attempt_at").bind(row.endpoint, row.notification_id, eventKey, reason).run(); failed++;
    }
  }
  return { considered: rows.results.length, sent, failed, removed, deferred };
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
