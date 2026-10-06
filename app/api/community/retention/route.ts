import { env } from "cloudflare:workers";
import { getD1 } from "@/db";
import { hasCommunitySchema } from "@/lib/auth-schema";
import { purgeExpiredCommunityContent, type CommunityDatabase } from "@/lib/community";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!env.CRON_SECRET || request.headers.get("x-docentetuc-cron") !== env.CRON_SECRET) {
    return Response.json({ error: "No autorizado." }, { status: 401 });
  }
  const database = getD1();
  if (!await hasCommunitySchema(database)) return Response.json({ ok: true, skipped: "schema_unavailable" });
  try {
    const result = await purgeExpiredCommunityContent(database as unknown as CommunityDatabase);
    return Response.json({ ok: true, ...result });
  } catch (error) {
    console.error("community_retention_failed", error);
    return Response.json({ error: "Falló la purga de retención de Comunidad." }, { status: 500 });
  }
}
