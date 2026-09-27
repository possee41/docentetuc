import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { NotificationService } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!env.CRON_SECRET || request.headers.get("x-docentetuc-cron") !== env.CRON_SECRET) return Response.json({ error: "No autorizado." }, { status: 401 });
  try {
    const result = await new NotificationService(getD1(), env).process();
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("push_dispatch_failed", error);
    return Response.json({ error: "Falló el procesamiento de alertas." }, { status: 500 });
  }
}
