import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { enrollmentState, parseTrainingMetadata, trainingReminderKey } from "@/lib/training";
import { hydrateProfile, profileStorage } from "@/lib/profile";
import { DESIGNATION_STATUSES } from "@/lib/designations";

export const dynamic = "force-dynamic";

const value = (input: unknown, max = 300) => typeof input === "string" ? input.trim().slice(0, max) : "";

export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    const db = getD1();
    await db.prepare("INSERT INTO profiles (user_id, name, email) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email WHERE profiles.email IS NOT excluded.email").bind(user.userId, user.fullName || user.displayName.split("@")[0], user.email).run();
    await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) SELECT user_id, publication_id, 'CAPACITACION_ABRE', 'training-reminder:' || id || ':' || opens_at || ':' || COALESCE(advance_minutes,0), CURRENT_TIMESTAMP FROM training_reminders WHERE user_id=? AND notified=0 AND datetime(remind_at)<=datetime('now')").bind(user.userId).run();
    await db.prepare("UPDATE training_reminders SET notified=1, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND notified=0 AND datetime(remind_at)<=datetime('now')").bind(user.userId).run();
    await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) SELECT user_id, publication_id, 'AGENDA_RECORDATORIO', 'agenda-reminder:' || user_id || ':' || publication_id || ':' || agenda_reminder_at, CURRENT_TIMESTAMP FROM saved_publications WHERE user_id=? AND in_agenda=1 AND agenda_reminder_notified=0 AND agenda_reminder_at IS NOT NULL AND datetime(agenda_reminder_at)<=datetime('now')").bind(user.userId).run();
    await db.prepare("UPDATE saved_publications SET agenda_reminder_notified=1 WHERE user_id=? AND in_agenda=1 AND agenda_reminder_notified=0 AND agenda_reminder_at IS NOT NULL AND datetime(agenda_reminder_at)<=datetime('now')").bind(user.userId).run();
    const [profile, publications, saved, notifications, reminders, designations, manualEvents, sync] = await Promise.all([
      db.prepare("SELECT * FROM profiles WHERE user_id=?").bind(user.userId).first(),
      db.prepare("SELECT * FROM publications ORDER BY COALESCE(ends_at, starts_at, updated_at) DESC LIMIT 1500").all(),
      db.prepare("SELECT publication_id, in_agenda, followed, agenda_at, agenda_notes, agenda_reminder_at, agenda_reminder_notified, saved_at FROM saved_publications WHERE user_id=?").bind(user.userId).all(),
      db.prepare("SELECT n.*, p.title, p.kind FROM notifications n JOIN publications p ON p.id=n.publication_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100").bind(user.userId).all(),
      db.prepare("SELECT id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified FROM training_reminders WHERE user_id=? ORDER BY opens_at").bind(user.userId).all(),
      db.prepare("SELECT id, publication_id, status, role, subject, school, address, locality, applied_at, appointment_at, shift, board, documentation, order_number, notes, official_url, reminder_at, reminder_notified, created_at, updated_at FROM designation_tracking WHERE user_id=? ORDER BY COALESCE(appointment_at, applied_at, updated_at) DESC").bind(user.userId).all(),
      db.prepare("SELECT id, title, notes, category, starts_at, all_day, recurrence, reminder_minutes, reminder_at, reminder_notified, created_at, updated_at FROM manual_events WHERE user_id=? ORDER BY starts_at").bind(user.userId).all(),
      db.prepare("SELECT * FROM sync_state ORDER BY source").all(),
    ]);
    return Response.json({ profile: profile ? hydrateProfile(profile as Record<string, unknown>) : null, publications: publications.results, saved: saved.results, notifications: notifications.results, reminders: reminders.results, designations: designations.results, manualEvents: manualEvents.results, sync: sync.results });
  } catch (error) {
    console.error("[api/app] GET failed", error);
    return Response.json({ error: authError(error) ? "Iniciá sesión para continuar." : "No se pudieron cargar los datos." }, { status: authError(error) ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(request);
    const body = await request.json() as Record<string, unknown>;
    const action = value(body.action, 30);
    const db = getD1();
    if (action === "save_profile") {
      const columns = ["name", "level", "area", "subjects", "junta", "roles", "department", "locality", "shifts", "wants_interim", "wants_substitute", "training_interests", "notify_new_trainings", "training_notify_scope", "training_match_threshold"];
      const fields = [value(body.name, 100) || "Docente", profileStorage(body.levels ?? body.level, 120), profileStorage(body.areas ?? body.area, 180), profileStorage(body.subjects), profileStorage(body.boards ?? body.junta, 240), profileStorage(body.roles, 300), value(body.department, 100), value(body.locality, 100), profileStorage(body.shifts, 100), body.wantsInterim === true ? 1 : 0, body.wantsSubstitute === true ? 1 : 0, profileStorage(body.trainingInterests), body.notifyNewTrainings === true ? 1 : 0, value(body.trainingNotifyScope, 20) || "relevant", Math.min(100, Math.max(50, Number(body.trainingMatchThreshold) || 80))];
      await db.prepare(`UPDATE profiles SET ${columns.map((column) => `${column}=?`).join(",")}, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND (${columns.map((column) => `${column} IS NOT ?`).join(" OR ")})`)
        .bind(...fields, user.userId, ...fields).run();
    } else if (action === "save_matching_profile") {
      const fields = [profileStorage(body.boards, 240), profileStorage(body.characters, 80), profileStorage(body.circuits, 80), Math.min(100, Math.max(70, Number(body.personalMatchThreshold) || 85))];
      await db.prepare("UPDATE profiles SET junta=?, characters=?, circuits=?, personal_match_threshold=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND (junta IS NOT ? OR characters IS NOT ? OR circuits IS NOT ? OR personal_match_threshold IS NOT ?)")
        .bind(...fields, user.userId, ...fields).run();
    } else if (action === "set_training_alert_preferences") {
      const fields = [body.enabled === true ? 1 : 0, Math.min(100, Math.max(50, Number(body.threshold) || 80))];
      await db.prepare("UPDATE profiles SET notify_new_trainings=?, training_match_threshold=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND (notify_new_trainings IS NOT ? OR training_match_threshold IS NOT ?)")
        .bind(...fields, user.userId, ...fields).run();
    } else if (action === "save_designation") {
      const publicationId = value(body.publicationId, 120), status = value(body.status, 30).toUpperCase();
      if (!DESIGNATION_STATUSES.includes(status as typeof DESIGNATION_STATUSES[number])) return Response.json({ error: "Estado de designación inválido." }, { status: 400 });
      const publication = await db.prepare("SELECT id, official_url FROM publications WHERE id=? AND kind='vacante'").bind(publicationId).first<{ id: string; official_url: string }>();
      if (!publication) return Response.json({ error: "Designación inválida." }, { status: 400 });
      const optionalDate = (input: unknown) => { const raw = value(input, 40); if (!raw) return null; const date = new Date(raw); return Number.isNaN(date.getTime()) ? null : date.toISOString(); };
      const reminderAt = optionalDate(body.reminderAt), id = `${user.userId}:${publicationId}`;
      await db.prepare(`INSERT INTO designation_tracking (id, user_id, publication_id, status, role, subject, school, address, locality, applied_at, appointment_at, shift, board, documentation, order_number, notes, official_url, reminder_at, reminder_notified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
        ON CONFLICT(id) DO UPDATE SET status=excluded.status, role=excluded.role, subject=excluded.subject, school=excluded.school, address=excluded.address, locality=excluded.locality,
        applied_at=excluded.applied_at, appointment_at=excluded.appointment_at, shift=excluded.shift, board=excluded.board, documentation=excluded.documentation, order_number=excluded.order_number,
        notes=excluded.notes, official_url=excluded.official_url, reminder_at=excluded.reminder_at, reminder_notified=CASE WHEN designation_tracking.reminder_at IS excluded.reminder_at THEN designation_tracking.reminder_notified ELSE 0 END, updated_at=CURRENT_TIMESTAMP
        WHERE designation_tracking.status IS NOT excluded.status OR designation_tracking.role IS NOT excluded.role OR designation_tracking.subject IS NOT excluded.subject OR designation_tracking.school IS NOT excluded.school OR designation_tracking.address IS NOT excluded.address OR designation_tracking.locality IS NOT excluded.locality OR designation_tracking.applied_at IS NOT excluded.applied_at OR designation_tracking.appointment_at IS NOT excluded.appointment_at OR designation_tracking.shift IS NOT excluded.shift OR designation_tracking.board IS NOT excluded.board OR designation_tracking.documentation IS NOT excluded.documentation OR designation_tracking.order_number IS NOT excluded.order_number OR designation_tracking.notes IS NOT excluded.notes OR designation_tracking.official_url IS NOT excluded.official_url OR designation_tracking.reminder_at IS NOT excluded.reminder_at`)
        .bind(id, user.userId, publicationId, status, value(body.role, 200), value(body.subject, 200), value(body.school, 250), value(body.address, 250), value(body.locality, 120), optionalDate(body.appliedAt), optionalDate(body.appointmentAt), value(body.shift, 80), value(body.board, 180), value(body.documentation, 500), value(body.orderNumber, 120), value(body.notes, 1000), publication.official_url, reminderAt).run();
    } else if (action === "set_training_reminder") {
      const publicationId = value(body.publicationId, 120);
      const publication = await db.prepare("SELECT id, metadata, status, normalized_status FROM publications WHERE id=? AND kind='capacitacion'").bind(publicationId).first<{ id: string; metadata: string; status: string; normalized_status: string }>();
      const metadata = parseTrainingMetadata(publication?.metadata);
      if (!publication || !metadata?.registrationOpensAt || !metadata.trainingId) return Response.json({ error: "La fuente oficial no informó una apertura válida." }, { status: 400 });
      if (enrollmentState(metadata, publication.status, publication.normalized_status) === "CERRADA") return Response.json({ error: "La preinscripción ya está cerrada según la fuente." }, { status: 400 });
      const opens = new Date(metadata.registrationOpensAt);
      if (!Number.isFinite(opens.getTime()) || opens.getTime() <= Date.now()) return Response.json({ error: "La apertura ya pasó; no se puede crear un recordatorio nuevo." }, { status: 400 });
      const advances = Array.isArray(body.advanceMinutes) ? [...new Set(body.advanceMinutes.map(Number))] : [];
      if (!advances.length || advances.some((advance) => ![10080, 4320, 1440, 60, 0].includes(advance))) return Response.json({ error: "Elegí al menos un aviso válido." }, { status: 400 });
      const reminderKey = trainingReminderKey(metadata);
      const reminderIds = advances.map((advance) => `${user.userId}:${reminderKey}:${advance}`);
      await db.prepare(`DELETE FROM training_reminders WHERE user_id=? AND training_id=? AND id NOT IN (${reminderIds.map(() => "?").join(",")})`).bind(user.userId, reminderKey, ...reminderIds).run();
      await db.batch(advances.map((advance) => {
        const remindAt = new Date(opens.getTime() - advance * 60000), id = `${user.userId}:${reminderKey}:${advance}`;
        return db.prepare(`INSERT INTO training_reminders (id, user_id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
          ON CONFLICT(id) DO UPDATE SET publication_id=excluded.publication_id, opens_at=excluded.opens_at, precision=excluded.precision, advance_minutes=excluded.advance_minutes, remind_at=excluded.remind_at,
            notified=CASE WHEN training_reminders.opens_at IS excluded.opens_at AND training_reminders.remind_at IS excluded.remind_at THEN training_reminders.notified ELSE 0 END, updated_at=CURRENT_TIMESTAMP
          WHERE training_reminders.publication_id IS NOT excluded.publication_id OR training_reminders.opens_at IS NOT excluded.opens_at OR training_reminders.precision IS NOT excluded.precision OR training_reminders.advance_minutes IS NOT excluded.advance_minutes OR training_reminders.remind_at IS NOT excluded.remind_at`)
          .bind(id, user.userId, reminderKey, publicationId, metadata.registrationOpensAt, metadata.registrationHasTime ? "datetime" : "date", advance, remindAt.toISOString());
      }));
    } else if (action === "remove_training_reminder") {
      await db.prepare("DELETE FROM training_reminders WHERE user_id=? AND training_id=?").bind(user.userId, value(body.trainingId, 80)).run();
    } else if (["save", "agenda", "follow"].includes(action)) {
      const id = value(body.publicationId, 120);
      if (!id) return Response.json({ error: "Publicación inválida." }, { status: 400 });
      const enabled = body.enabled !== false ? 1 : 0;
      if (action === "save" && !enabled) await db.prepare("DELETE FROM saved_publications WHERE user_id=? AND publication_id=?").bind(user.userId, id).run();
      else {
        await db.prepare("INSERT INTO saved_publications (user_id, publication_id) VALUES (?, ?) ON CONFLICT(user_id, publication_id) DO NOTHING").bind(user.userId, id).run();
        if (action === "agenda") {
          const rawAgendaAt = value(body.agendaAt, 40), agendaDate = rawAgendaAt ? new Date(rawAgendaAt) : null;
          if (rawAgendaAt && (!agendaDate || Number.isNaN(agendaDate.getTime()))) return Response.json({ error: "Fecha de agenda inválida." }, { status: 400 });
          const rawReminderAt = value(body.agendaReminderAt, 40), reminderDate = rawReminderAt ? new Date(rawReminderAt) : null;
          if (rawReminderAt && (!reminderDate || Number.isNaN(reminderDate.getTime()) || (agendaDate && reminderDate > agendaDate))) return Response.json({ error: "Recordatorio de agenda inválido." }, { status: 400 });
          const agendaFields = [enabled, enabled && agendaDate ? agendaDate.toISOString() : null, enabled ? value(body.agendaNotes, 1000) : "", enabled && reminderDate ? reminderDate.toISOString() : null];
          await db.prepare("UPDATE saved_publications SET in_agenda=?, agenda_at=?, agenda_notes=?, agenda_reminder_at=?, agenda_reminder_notified=CASE WHEN agenda_reminder_at IS ? THEN agenda_reminder_notified ELSE 0 END WHERE user_id=? AND publication_id=? AND (in_agenda IS NOT ? OR agenda_at IS NOT ? OR agenda_notes IS NOT ? OR agenda_reminder_at IS NOT ?)").bind(...agendaFields, agendaFields[3], user.userId, id, ...agendaFields).run();
        }
        if (action === "follow") await db.prepare("UPDATE saved_publications SET followed=? WHERE user_id=? AND publication_id=? AND followed IS NOT ?").bind(enabled, user.userId, id, enabled).run();
      }
    } else if (action === "save_event") {
      const title = value(body.title, 160), startsAt = value(body.startsAt, 40), starts = new Date(startsAt);
      if (!title || !startsAt || Number.isNaN(starts.getTime())) return Response.json({ error: "Completá un título y una fecha válida." }, { status: 400 });
      const reminderAt = value(body.reminderAt, 40), reminder = reminderAt ? new Date(reminderAt) : null;
      if (reminderAt && (!reminder || Number.isNaN(reminder.getTime()) || reminder > starts)) return Response.json({ error: "El recordatorio debe ser anterior al evento." }, { status: 400 });
      const recurrence = value(body.recurrence, 12) || "none";
      if (!["none", "daily", "weekly", "monthly"].includes(recurrence)) return Response.json({ error: "Repetición inválida." }, { status: 400 });
      const allDay = body.allDay === true ? 1 : 0, reminderMinutes = body.reminderMinutes == null ? null : Math.max(0, Math.min(43_200, Math.floor(Number(body.reminderMinutes))));
      if (reminderMinutes !== null && !Number.isFinite(reminderMinutes)) return Response.json({ error: "Recordatorio inválido." }, { status: 400 });
      const id = value(body.id, 100) || `${user.userId}:${crypto.randomUUID()}`;
      await db.prepare(`INSERT INTO manual_events (id, user_id, title, notes, category, starts_at, all_day, recurrence, reminder_minutes, reminder_at, reminder_notified, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, CURRENT_TIMESTAMP)
        ON CONFLICT(id) DO UPDATE SET title=excluded.title, notes=excluded.notes, category=excluded.category, starts_at=excluded.starts_at, all_day=excluded.all_day, recurrence=excluded.recurrence, reminder_minutes=excluded.reminder_minutes, reminder_at=excluded.reminder_at, reminder_notified=0, updated_at=CURRENT_TIMESTAMP
        WHERE manual_events.user_id=excluded.user_id AND (manual_events.title IS NOT excluded.title OR manual_events.notes IS NOT excluded.notes OR manual_events.category IS NOT excluded.category OR manual_events.starts_at IS NOT excluded.starts_at OR manual_events.all_day IS NOT excluded.all_day OR manual_events.recurrence IS NOT excluded.recurrence OR manual_events.reminder_minutes IS NOT excluded.reminder_minutes OR manual_events.reminder_at IS NOT excluded.reminder_at)`)
        .bind(id, user.userId, title, value(body.notes, 1000), value(body.category, 40) || "Personal", starts.toISOString(), allDay, recurrence, reminderMinutes, reminder ? reminder.toISOString() : null).run();
    } else if (action === "delete_event") {
      await db.prepare("DELETE FROM manual_events WHERE id=? AND user_id=?").bind(value(body.id, 100), user.userId).run();
    } else if (action === "read_notification") {
      await db.prepare("UPDATE notifications SET read=1 WHERE id=? AND user_id=? AND read=0").bind(Number(body.id), user.userId).run();
    } else return Response.json({ error: "Acción no admitida." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: authError(error) ? "Iniciá sesión para continuar." : "No se pudo guardar el cambio." }, { status: authError(error) ? 401 : 500 });
  }
}
