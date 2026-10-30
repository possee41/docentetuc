import { getD1 } from "@/db";
import { APP_PUBLICATIONS_QUERY } from "@/lib/app-publications-query";
import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

const TTL_MS = 60_000;
const EXPIRES_HEADER = "X-Public-App-Cache-Expires";

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
export async function GET(request: Request) {
  const settings = env as unknown as { PUBLIC_APP_CACHE_ENABLED?: string; PUBLIC_APP_CACHE_VERSION?: string };
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
      db.prepare(APP_PUBLICATIONS_QUERY).all(),
      db.prepare("SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state ORDER BY source").all(),
    ]);
    const response = Response.json({ profile: null, publicProfile: null, publications: publications.results, saved: [], notifications: [], reminders: [], designations: [], manualEvents: [], sync: sync.results });
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
