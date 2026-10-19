import { getD1 } from "@/db";
import { APP_PUBLICATIONS_QUERY } from "@/lib/app-publications-query";

export const dynamic = "force-dynamic";

// Public source data must remain readable when an installation needs account recovery.
// Never query installation, profile, agenda, saved items, or session data here.
export async function GET() {
  try {
    const db = getD1();
    const [publications, sync] = await Promise.all([
      db.prepare(APP_PUBLICATIONS_QUERY).all(),
      db.prepare("SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source").all(),
    ]);
    return Response.json({ profile: null, publicProfile: null, publications: publications.results, saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: sync.results });
  } catch (error) {
    console.error("[api/public-app] GET failed", error);
    return Response.json({ error: "No se pudo cargar la información pública." }, { status: 503 });
  }
}
