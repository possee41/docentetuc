import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { dispatchPushNotifications } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!env.CRON_SECRET || request.headers.get("x-docentetuc-cron") !== env.CRON_SECRET) return Response.json({ error: "No autorizado." }, { status: 401 });
  try {
    const delivery = await dispatchPushNotifications(getD1(), env);
    return Response.json({ ok: true, delivery });
  } catch (error) {
    console.error("push_dispatch_failed", error);
    return Response.json({ error: "Falló el procesamiento de alertas." }, { status: 500 });
  }
}
