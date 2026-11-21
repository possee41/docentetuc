import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { readSyncHealth } from "@/lib/sync-health";

export const dynamic = "force-dynamic";

// Source writes run in the independent Node importers. This endpoint remains
// for authenticated status checks; it cannot start a legacy catalog sweep.
export async function POST(request: Request) {
  try {
    const scheduled = Boolean(env.CRON_SECRET) && request.headers.get("x-docentetuc-cron") === env.CRON_SECRET;
    if (!scheduled) await currentUser(request);
    const sources = await readSyncHealth(getD1());
    return Response.json({ ok: true, skipped: true, reason: "external_importers_only", sources });
  } catch (error) {
    console.error("sync_health_failed", error);
    return Response.json({ error: authError(error) ? "Iniciá sesión para consultar el estado." : "No se pudo consultar el estado de las fuentes." },
      { status: authError(error) ? 401 : 502 });
  }
}
