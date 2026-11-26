import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
export type PublicAppSettings = { PUBLIC_APP_CACHE_ENABLED?: string; PUBLIC_APP_CACHE_VERSION?: string };

const TTL_MS = 60_000;
const EXPIRES_HEADER = "X-Public-App-Cache-Expires";
// Same public selection/order, encoded one row at a time in SQLite. Avoid
// decoding 35 properties per row and re-encoding large metadata in the Worker.
// Per-row JSON avoids D1's single-value size limit for the complete catalogue.
const PUBLIC_COLUMNS = 'id,source,external_id,kind,category,title,summary,level,area,junta,location,shift,character,starts_at,ends_at,status,official_url,content_hash,source_updated_at,first_seen_at,updated_at,metadata,circuit,source_circuit_raw,circuit_inference_source,last_seen_at,last_changed_at,source_published_at,registration_open_at,registration_close_at,expires_at,source_status,normalized_status,removed_at,circuit_confidence'.split(',');
export const PUBLIC_APP_ROWS_QUERY = `SELECT json_object(${PUBLIC_COLUMNS.map(column => `'${column}',${column}`).join(',')}) AS row_json FROM (${APP_PUBLICATIONS_QUERY})`;

function clientResponse(response: Response, state: string) {
  const headers = new Headers(response.headers);
  // Only our explicit Cache API entry may reuse this response, never a browser/proxy.
  headers.set("Cache-Control", "no-store");
  headers.set("X-Public-App-Cache", state);
  headers.delete(EXPIRES_HEADER);
  return new Response(response.body, { status: response.status, headers });
}

// Public source data must remain readable when an installation needs account recovery.
// Never query installation, profile, agenda, saved items, or session data here.
export async function getPublicApp(request: Request, getD1: () => D1Database, settings: PublicAppSettings = {}) {
  const url = new URL(request.url);
  // No parameters currently affect this endpoint. Bypass unknown ones rather than
  // accidentally sharing a future filtered response. Never copy cookies/auth headers.
  const eligible = request.method === "GET" && url.pathname === "/api/public-app" && !url.search
    && !["0", "false"].includes(settings.PUBLIC_APP_CACHE_ENABLED || "");
  const cache = eligible && typeof caches !== "undefined"
    ? (caches as CacheStorage & { default?: Cache }).default : undefined;
  const key = new Request(`${url.origin}/api/public-app?__cache=${encodeURIComponent(settings.PUBLIC_APP_CACHE_VERSION || "v1")}`);
  if (cache) {
    try {
      const hit = await cache.match(key);
      const expires = Number(hit?.headers.get(EXPIRES_HEADER));
      if (hit?.status === 200 && !hit.headers.has("Set-Cookie")
        && hit.headers.get("Cache-Control") === "public, max-age=60"
        && expires > Date.now() && expires <= Date.now() + TTL_MS) return clientResponse(hit, "HIT");
    } catch { /* Cache unavailability must not prevent reading public data. */ }
  }
  const expires = Date.now() + TTL_MS;
  try {
    const db = getD1();
    const [publications, sync] = await Promise.all([
      db.prepare(PUBLIC_APP_ROWS_QUERY).all<{ row_json: string }>(),
      db.prepare("SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source").all(),
    ]);
    const body = '{"profile":null,"publicProfile":null,"publications":['
      + publications.results.map(row => row.row_json).join(',')
      + '],"saved":[],"notifications":[],"reminders":[],"designations":[],"manualEvents":[],"sync":'
      + JSON.stringify(sync.results) + '}';
    const response = new Response(body, { headers: { 'Content-Type': 'application/json' } });
    if (cache && Date.now() < expires) {
      const stored = response.clone();
      stored.headers.set("Cache-Control", "public, max-age=60");
      stored.headers.set(EXPIRES_HEADER, String(expires));
      try { await cache.put(key, stored); }
      catch { /* Return the real D1 result even if the cache cannot store it. */ }
    }
    return clientResponse(response, cache ? "MISS" : "BYPASS");
  } catch (error) {
    console.error("[api/public-app] GET failed", error);
    return clientResponse(Response.json({ error: "No se pudo cargar la información pública." }, { status: 503 }), "BYPASS");
  }
}

// Public-only fast path: other methods and paths retain framework handling.
export function publicAppApi(request: Request, getD1: () => D1Database, settings: PublicAppSettings = {}) {
  return request.method === "GET" && new URL(request.url).pathname === "/api/public-app"
    ? getPublicApp(request, getD1, settings) : null;
}
