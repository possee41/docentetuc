import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { parseTrainingMetadata } from "@/lib/training";

export const dynamic = "force-dynamic";

const value = (input: unknown, max = 300) => typeof input === "string" ? input.trim().slice(0, max) : "";

export async function GET(request: Request) {
  try {
    const user = await currentUser(request);
    const db = getD1();
    await db.prepare("INSERT INTO profiles (user_id, name, email) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email").bind(user.userId, user.fullName || user.displayName.split("@")[0], user.email).run();
    await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type) SELECT user_id, publication_id, 'CAPACITACION_ABRE' FROM training_reminders WHERE user_id=? AND notified=0 AND datetime(remind_at)<=datetime('now')").bind(user.userId).run();
    await db.prepare("UPDATE training_reminders SET notified=1, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND notified=0 AND datetime(remind_at)<=datetime('now')").bind(user.userId).run();
    const [profile, publications, saved, notifications, reminders, sync] = await Promise.all([
      db.prepare("SELECT * FROM profiles WHERE user_id=?").bind(user.userId).first(),
      db.prepare("SELECT * FROM publications ORDER BY COALESCE(ends_at, starts_at, updated_at) DESC LIMIT 500").all(),
      db.prepare("SELECT publication_id, in_agenda, followed, saved_at FROM saved_publications WHERE user_id=?").bind(user.userId).all(),
      db.prepare("SELECT n.*, p.title, p.kind FROM notifications n JOIN publications p ON p.id=n.publication_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100").bind(user.userId).all(),
      db.prepare("SELECT id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified FROM training_reminders WHERE user_id=? ORDER BY opens_at").bind(user.userId).all(),
      db.prepare("SELECT * FROM sync_state ORDER BY source").all(),
    ]);
    return Response.json({ profile, publications: publications.results, saved: saved.results, notifications: notifications.results, reminders: reminders.results, sync: sync.results });
  } catch (error) {
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
      await db.prepare(`UPDATE profiles SET name=?, level=?, area=?, subjects=?, junta=?, department=?, locality=?, shifts=?, wants_interim=?, wants_substitute=?, training_interests=?, notify_new_trainings=?, training_notify_scope=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`)
        .bind(value(body.name, 100) || "Docente", value(body.level, 80), value(body.area, 120), value(body.subjects), value(body.junta, 120), value(body.department, 100), value(body.locality, 100), value(body.shifts, 100), body.wantsInterim === false ? 0 : 1, body.wantsSubstitute === false ? 0 : 1, value(body.trainingInterests), body.notifyNewTrainings === true ? 1 : 0, value(body.trainingNotifyScope, 20) || "relevant", user.userId).run();
    } else if (action === "set_training_reminder") {
      const publicationId = value(body.publicationId, 120);
      const publication = await db.prepare("SELECT id, metadata FROM publications WHERE id=? AND kind='capacitacion'").bind(publicationId).first<{ id: string; metadata: string }>();
      const metadata = parseTrainingMetadata(publication?.metadata);
      if (!publication || !metadata?.registrationOpensAt || !metadata.trainingId) return Response.json({ error: "La fuente oficial no informó una apertura válida." }, { status: 400 });
      const mode = value(body.mode, 20), opens = new Date(metadata.registrationOpensAt);
      if (!metadata.registrationHasTime && mode === "one_hour") return Response.json({ error: "El sitio oficial no informa el horario exacto." }, { status: 400 });
      const advance = mode === "one_day" ? 1440 : mode === "one_hour" ? 60 : mode === "at_open" ? 0 : null;
      const custom = value(body.customRemindAt, 40), remindAt = advance == null ? new Date(custom) : new Date(opens.getTime() - advance * 60000);
      if (Number.isNaN(remindAt.getTime()) || remindAt.getTime() > opens.getTime()) return Response.json({ error: "Elegí un recordatorio válido, anterior a la apertura." }, { status: 400 });
      const id = `${user.userId}:${metadata.trainingId}`;
      await db.prepare("INSERT INTO training_reminders (id, user_id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0) ON CONFLICT(id) DO UPDATE SET publication_id=excluded.publication_id, opens_at=excluded.opens_at, precision=excluded.precision, advance_minutes=excluded.advance_minutes, remind_at=excluded.remind_at, notified=0, updated_at=CURRENT_TIMESTAMP").bind(id, user.userId, metadata.trainingId, publicationId, metadata.registrationOpensAt, metadata.registrationHasTime ? "datetime" : "date", advance, remindAt.toISOString()).run();
    } else if (action === "remove_training_reminder") {
      await db.prepare("DELETE FROM training_reminders WHERE user_id=? AND training_id=?").bind(user.userId, value(body.trainingId, 80)).run();
    } else if (["save", "agenda", "follow"].includes(action)) {
      const id = value(body.publicationId, 120);
      if (!id) return Response.json({ error: "Publicación inválida." }, { status: 400 });
      const enabled = body.enabled !== false ? 1 : 0;
      if (action === "save" && !enabled) await db.prepare("DELETE FROM saved_publications WHERE user_id=? AND publication_id=?").bind(user.userId, id).run();
      else {
        await db.prepare("INSERT INTO saved_publications (user_id, publication_id) VALUES (?, ?) ON CONFLICT(user_id, publication_id) DO NOTHING").bind(user.userId, id).run();
        if (action === "agenda") await db.prepare("UPDATE saved_publications SET in_agenda=? WHERE user_id=? AND publication_id=?").bind(enabled, user.userId, id).run();
        if (action === "follow") await db.prepare("UPDATE saved_publications SET followed=? WHERE user_id=? AND publication_id=?").bind(enabled, user.userId, id).run();
      }
    } else if (action === "read_notification") {
      await db.prepare("UPDATE notifications SET read=1 WHERE id=? AND user_id=?").bind(Number(body.id), user.userId).run();
    } else return Response.json({ error: "Acción no admitida." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: authError(error) ? "Iniciá sesión para continuar." : "No se pudo guardar el cambio." }, { status: authError(error) ? 401 : 500 });
  }
}
