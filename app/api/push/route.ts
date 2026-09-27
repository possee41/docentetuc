import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { WebPushProvider, validSubscription } from "@/lib/push";

export const dynamic = "force-dynamic";

const deviceId = (request: Request) => request.headers.get("x-docentetuc-device") || "";
const validDevice = (value: string) => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(value);
const boolean = (value: unknown, fallback = true) => typeof value === "boolean" ? Number(value) : Number(fallback);
const time = (value: unknown, fallback: string) => typeof value === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;

async function migrateDeviceSubscription(db: D1Database, userId: string, id: string) {
  if (!validDevice(id) || userId === `device:${id}`) return;
  await db.prepare("UPDATE push_subscriptions SET user_id=?, updated_at=CURRENT_TIMESTAMP WHERE user_id=? AND device_id=?").bind(userId, `device:${id}`, id).run();
}

export async function GET(request: Request) {
  try {
    const user = await currentUser(request), db = getD1(), id = deviceId(request);
    await migrateDeviceSubscription(db, user.userId, id);
    const [subscription, preferences] = await Promise.all([
      db.prepare("SELECT COUNT(*) count FROM push_subscriptions WHERE user_id=? AND device_id=? AND active=1").bind(user.userId, id).first<{ count: number }>(),
      db.prepare("SELECT * FROM push_preferences WHERE user_id=?").bind(user.userId).first<Record<string, unknown>>(),
    ]);
    return Response.json({ supported: Boolean(env.VAPID_PUBLIC_KEY), vapidPublicKey: env.VAPID_PUBLIC_KEY || "", subscribed: Boolean(subscription?.count), preferences: preferences || null });
  } catch (error) {
    return Response.json({ error: authError(error) ? "Iniciá sesión para continuar." : "No se pudo consultar el estado de las alertas." }, { status: authError(error) ? 401 : 500 });
  }
}

export async function POST(request: Request) {
  try {
    const user = await currentUser(request), db = getD1(), id = deviceId(request);
    if (!validDevice(id)) return Response.json({ error: "Dispositivo inválido." }, { status: 400 });
    const body = await request.json() as Record<string, unknown>, action = String(body.action || "");
    await migrateDeviceSubscription(db, user.userId, id);
    if (action === "subscribe") {
      if (!validSubscription(body.subscription)) return Response.json({ error: "Suscripción push inválida." }, { status: 400 });
      const subscription = body.subscription;
      await db.prepare("INSERT INTO push_subscriptions (endpoint, user_id, device_id, p256dh, auth, expiration_time, user_agent, active) VALUES (?, ?, ?, ?, ?, ?, ?, 1) ON CONFLICT(endpoint) DO UPDATE SET user_id=excluded.user_id, device_id=excluded.device_id, p256dh=excluded.p256dh, auth=excluded.auth, expiration_time=excluded.expiration_time, user_agent=excluded.user_agent, active=1, updated_at=CURRENT_TIMESTAMP, last_seen_at=CURRENT_TIMESTAMP")
        .bind(subscription.endpoint, user.userId, id, subscription.keys.p256dh, subscription.keys.auth, subscription.expirationTime, request.headers.get("user-agent")?.slice(0, 300) || "").run();
      await db.prepare("INSERT OR IGNORE INTO push_preferences (user_id) VALUES (?)").bind(user.userId).run();
    } else if (action === "unsubscribe") {
      const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
      await db.prepare("UPDATE push_subscriptions SET active=0, updated_at=CURRENT_TIMESTAMP WHERE endpoint=? AND user_id=? AND device_id=?").bind(endpoint, user.userId, id).run();
    } else if (action === "preferences") {
      await db.prepare(`INSERT INTO push_preferences (user_id, enabled, vacancies, trainings, commissions, reminders, date_changes, closing_soon, boards, designation_exact, designation_partial, designation_roles, quiet_start, quiet_end, timezone)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET enabled=excluded.enabled, vacancies=excluded.vacancies, trainings=excluded.trainings,
        commissions=excluded.commissions, reminders=excluded.reminders, date_changes=excluded.date_changes, closing_soon=excluded.closing_soon, boards=excluded.boards,
        designation_exact=excluded.designation_exact, designation_partial=excluded.designation_partial, designation_roles=excluded.designation_roles,
        quiet_start=excluded.quiet_start, quiet_end=excluded.quiet_end, timezone=excluded.timezone, updated_at=CURRENT_TIMESTAMP`)
        .bind(user.userId, boolean(body.enabled), boolean(body.vacancies), boolean(body.trainings), boolean(body.commissions), boolean(body.reminders), boolean(body.dateChanges), boolean(body.closingSoon), boolean(body.boards, false), boolean(body.designationExact), boolean(body.designationPartial), boolean(body.designationRoles), time(body.quietStart, "22:00"), time(body.quietEnd, "07:00"), "America/Argentina/Buenos_Aires").run();
    } else if (action === "test") {
      if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY || !env.VAPID_SUBJECT) return Response.json({ error: "Las claves push todavía no están configuradas." }, { status: 503 });
      const bucket = `${user.userId}:push-test:${new Date().toISOString().slice(0, 10)}`;
      await db.prepare("INSERT INTO push_rate_limits (user_bucket, request_count, expires_at) VALUES (?, 1, datetime('now','+1 day')) ON CONFLICT(user_bucket) DO UPDATE SET request_count=request_count+1").bind(bucket).run();
      const usage = await db.prepare("SELECT request_count FROM push_rate_limits WHERE user_bucket=?").bind(bucket).first<{ request_count: number }>();
      if ((usage?.request_count || 0) > 5) return Response.json({ error: "Alcanzaste el límite diario de pruebas." }, { status: 429 });
      const subscription = await db.prepare("SELECT endpoint, p256dh, auth, expiration_time FROM push_subscriptions WHERE user_id=? AND device_id=? AND active=1 ORDER BY updated_at DESC LIMIT 1").bind(user.userId, id).first<{ endpoint: string; p256dh: string; auth: string; expiration_time: number | null }>();
      if (!subscription) return Response.json({ error: "Primero activá las alertas en este dispositivo." }, { status: 400 });
      const provider = new WebPushProvider({ publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY, subject: env.VAPID_SUBJECT });
      const response = await provider.send({ endpoint: subscription.endpoint, expirationTime: subscription.expiration_time, keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, { title: "DocenteTuc está listo", body: "Las alertas reales están activadas en este dispositivo.", tag: `test:${Date.now()}`, url: "/?push-test=ok" });
      if (response.status === 404 || response.status === 410) await db.prepare("UPDATE push_subscriptions SET active=0 WHERE endpoint=?").bind(subscription.endpoint).run();
      if (!response.ok) return Response.json({ error: `El servicio push respondió ${response.status}. Volvé a activar las alertas.` }, { status: 502 });
    } else return Response.json({ error: "Acción no admitida." }, { status: 400 });
    return Response.json({ ok: true });
  } catch (error) {
    console.error("push_action_failed", error);
    return Response.json({ error: authError(error) ? "Iniciá sesión para continuar." : "No se pudo completar la acción de alertas." }, { status: authError(error) ? 401 : 500 });
  }
}
