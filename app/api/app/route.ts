import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";

export const dynamic = "force-dynamic";

const value = (input: unknown, max = 300) => typeof input === "string" ? input.trim().slice(0, max) : "";

export async function GET() {
  try {
    const user = await currentUser();
    const db = getD1();
    await db.prepare("INSERT INTO profiles (user_id, name, email) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET email=excluded.email").bind(user.userId, user.fullName || user.displayName.split("@")[0], user.email).run();
    const [profile, publications, saved, notifications, sync] = await Promise.all([
      db.prepare("SELECT * FROM profiles WHERE user_id=?").bind(user.userId).first(),
      db.prepare("SELECT * FROM publications ORDER BY COALESCE(ends_at, starts_at, updated_at) DESC LIMIT 500").all(),
      db.prepare("SELECT publication_id, in_agenda, followed, saved_at FROM saved_publications WHERE user_id=?").bind(user.userId).all(),
      db.prepare("SELECT n.*, p.title, p.kind FROM notifications n JOIN publications p ON p.id=n.publication_id WHERE n.user_id=? ORDER BY n.created_at DESC LIMIT 100").bind(user.userId).all(),
      db.prepare("SELECT * FROM sync_state ORDER BY source").all(),
    ]);
    return Response.json({ profile, publications: publications.results, saved: saved.results, notifications: notifications.results, sync: sync.results });
  } catch (error) {
    return Response.json({ error: authError(error) ? "Iniciá sesión para continuar." : "No se pudieron cargar los datos." }, { status: authError(error) ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser();
    const body = await request.json() as Record<string, unknown>;
    const action = value(body.action, 30);
    const db = getD1();
    if (action === "save_profile") {
      await db.prepare(`UPDATE profiles SET name=?, level=?, area=?, subjects=?, junta=?, department=?, locality=?, shifts=?, wants_interim=?, wants_substitute=?, training_interests=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=?`)
        .bind(value(body.name, 100) || "Docente", value(body.level, 80), value(body.area, 120), value(body.subjects), value(body.junta, 120), value(body.department, 100), value(body.locality, 100), value(body.shifts, 100), body.wantsInterim === false ? 0 : 1, body.wantsSubstitute === false ? 0 : 1, value(body.trainingInterests), user.userId).run();
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
