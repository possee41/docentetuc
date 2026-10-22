// Isolated receiver for public Junta, CeNET and INFoD records. No scraping or notifications.
const sources = {
  juntas: { name: "Padrones y Comunicados", prefix: /^(?:padrones|drive|notice):/, hosts: new Set(["docs.google.com", "drive.google.com", "padrones.educaciontuc.gov.ar"]), secret: "JUNTAS_IMPORT_SECRET", health: ["Padrones", "Comunicados", "Llamados abiertos"] },
  cenet: { name: "CeNET / INET", prefix: /^cenet:/, hosts: new Set(["cenet.inet.edu.ar"]), secret: "CENET_IMPORT_SECRET", health: ["CeNET / INET"] },
  infd: { name: "INFoD / AulaS-TIC", prefix: /^infd:/, hosts: new Set(["red.infd.edu.ar"]), secret: "INFD_IMPORT_SECRET", health: ["INFoD / AulaS-TIC"] },
};
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const clean = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const date = (value) => value === null || (clean(value, 40) && Number.isFinite(Date.parse(value)));
const textFields = { externalId: 200, category: 120, title: 500, summary: 8000, level: 300, area: 300, junta: 300,
  location: 300, shift: 150, character: 300, status: 100, metadata: 16000 };
const dateFields = ["startsAt", "endsAt", "sourceUpdatedAt", "sourcePublishedAt", "registrationOpenAt", "registrationCloseAt", "expiresAt"];
const digest = async (value) => new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
async function authorized(header, secret) {
  const bearer = header?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
  if (!secret || !bearer) return false;
  const [a, b] = await Promise.all([digest(secret), digest(bearer)]);
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
function valid(item, source) {
  if (!item || typeof item !== "object" || Array.isArray(item) || !clean(item.id, 240) ||
      !/^[A-Za-z0-9:_-]+$/.test(item.id) || !source.prefix.test(item.id) ||
      item.source !== source.name || !["junta", "capacitacion"].includes(item.kind) ||
      (source.name === "Padrones y Comunicados") !== (item.kind === "junta") ||
      Object.entries(textFields).some(([name, max]) => !clean(item[name], max)) || !item.title ||
      !/^[a-f0-9]{64}$/.test(item.contentHash) || !dateFields.every((name) => date(item[name])) ||
      !["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "UNKNOWN"].includes(item.normalizedStatus)) return false;
  try {
    const url = new URL(item.officialUrl), metadata = JSON.parse(item.metadata);
    return url.protocol === "https:" && source.hosts.has(url.hostname) && !url.username && !url.password &&
      metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
      (item.kind === "junta"
        ? metadata.official?.version === 1 && Array.isArray(metadata.official.sources) &&
          metadata.official.sources.some((entry) => entry.url === item.officialUrl)
        : metadata.entity === "course" && metadata.trainingId === item.id &&
          metadata.source === source.name && metadata.sourceUrl === item.officialUrl);
  } catch { return false; }
}
const upsert = `INSERT INTO publications
  (id,source,external_id,kind,category,title,summary,level,area,junta,location,shift,character,starts_at,ends_at,status,
   official_url,metadata,content_hash,source_updated_at,source_published_at,registration_open_at,registration_close_at,expires_at,
   source_status,normalized_status,last_seen_at,last_changed_at)
  VALUES (${Array(28).fill("?").join(",")})
  ON CONFLICT(id) DO UPDATE SET category=excluded.category,title=excluded.title,summary=excluded.summary,
    level=excluded.level,area=excluded.area,junta=excluded.junta,location=excluded.location,shift=excluded.shift,
    character=excluded.character,starts_at=excluded.starts_at,ends_at=excluded.ends_at,status=excluded.status,
    official_url=excluded.official_url,metadata=excluded.metadata,content_hash=excluded.content_hash,
    source_updated_at=excluded.source_updated_at,source_published_at=excluded.source_published_at,
    registration_open_at=excluded.registration_open_at,registration_close_at=excluded.registration_close_at,
    expires_at=excluded.expires_at,source_status=excluded.source_status,normalized_status=excluded.normalized_status,
    removed_at=NULL,last_seen_at=excluded.last_seen_at,last_changed_at=excluded.last_changed_at,updated_at=CURRENT_TIMESTAMP
  WHERE publications.source=excluded.source AND (publications.content_hash<>excluded.content_hash OR publications.removed_at IS NOT NULL)`;
async function store(db, source, items) {
  const old = await db.prepare(`SELECT id,source,content_hash,removed_at FROM publications WHERE id IN (${items.map(() => "?").join(",")})`).bind(...items.map((item) => item.id)).all();
  if (old.results.some((row) => row.source !== source.name)) return { conflict: true };
  const previous = new Map(old.results.map((row) => [row.id, row]));
  const changed = items.filter((item) => !previous.has(item.id) || previous.get(item.id).content_hash !== item.contentHash || previous.get(item.id).removed_at !== null);
  const now = new Date().toISOString();
  const statements = changed.map((item) => db.prepare(upsert).bind(item.id,item.source,item.externalId,item.kind,item.category,item.title,item.summary,
    item.level,item.area,item.junta,item.location,item.shift,item.character,item.startsAt,item.endsAt,item.status,item.officialUrl,
    item.metadata,item.contentHash,item.sourceUpdatedAt,item.sourcePublishedAt,item.registrationOpenAt,item.registrationCloseAt,
    item.expiresAt,item.status,item.normalizedStatus,now,now));
  const results = statements.length ? await db.batch(statements) : [];
  const written = results.map((result) => Number(result.meta?.rows_written || 0) > 0);
  return { received: items.length, created: changed.filter((item, index) => written[index] && !previous.has(item.id)).length,
    updated: changed.filter((item, index) => written[index] && previous.has(item.id)).length,
    unchanged: items.length - written.filter(Boolean).length, queries: 1 + statements.length,
    rowsRead: Number(old.meta?.rows_read || 0) + results.reduce((n, result) => n + Number(result.meta?.rows_read || 0), 0),
    rowsWritten: results.reduce((n, result) => n + Number(result.meta?.rows_written || 0), 0) };
}
async function readBody(request) {
  if (Number(request.headers.get("content-length") || 0) > 100_000) throw new Error("TOO_LARGE");
  const reader = request.body?.getReader(); if (!reader) throw new Error("INVALID_JSON");
  const chunks = []; let size = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength;
    if (size > 100_000) { await reader.cancel(); throw new Error("TOO_LARGE"); } chunks.push(value); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); } catch { throw new Error("INVALID_JSON"); }
}
const worker = { async fetch(request, env) {
  const url = new URL(request.url), key = url.pathname.match(/^\/api\/internal\/public-source-import\/(juntas|cenet|infd)$/)?.[1], source = sources[key];
  if (!source) return reply({ error: "No encontrado." }, 404);
  if (!env.DB || !env[source.secret]) return reply({ error: "No configurado." }, 503);
  if (!await authorized(request.headers.get("authorization"), env[source.secret])) return reply({ error: "No autorizado." }, 401);
  if (request.method !== "POST") return reply({ error: "Método no permitido." }, 405);
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Se requiere JSON." }, 415);
  try {
    const payload = await readBody(request), now = new Date().toISOString();
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply({ error: "Operación inválida." }, 400);
    if (payload.mode === "batch") {
      const items = payload.items;
      if (!Array.isArray(items) || items.length < 1 || items.length > 5 || !items.every((item) => valid(item, source)) ||
          new Set(items.map((item) => item.id)).size !== items.length) return reply({ error: "Lote inválido." }, 400);
      const result = await store(env.DB, source, items);
      return result.conflict ? reply({ error: "Conflicto de fuente." }, 409) : reply({ ok: true, ...result });
    }
    if (payload.mode === "start" || payload.mode === "finish" || payload.mode === "error") {
      const health = payload.health;
      if (!Array.isArray(health) || !health.length || health.length > source.health.length ||
          new Set(health).size !== health.length || health.some((name) => !source.health.includes(name)))
        return reply({ error: "Fuentes inválidas." }, 400);
      if (payload.mode === "finish" && (payload.complete !== true || !Number.isInteger(payload.count) || payload.count < 0)) return reply({ error: "Operación inválida." }, 400);
      if (payload.mode === "error" && !/^[A-Z_]{2,40}$/.test(payload.code)) return reply({ error: "Operación inválida." }, 400);
      const statements = health.map((name) => payload.mode === "start"
        ? env.DB.prepare("INSERT INTO sync_state(source,synced_at,item_count,last_attempt_at,sync_status) VALUES(?,'',0,?,'PARTIAL') ON CONFLICT(source) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,sync_status='PARTIAL'").bind(name,now)
        : payload.mode === "finish"
          ? env.DB.prepare("UPDATE sync_state SET synced_at=?,last_successful_sync_at=?,sync_status='OK',error=NULL,error_code=NULL,error_message=NULL,item_count=? WHERE source=?").bind(now,now,payload.count,name)
          : env.DB.prepare("UPDATE sync_state SET sync_status=?,error_code=?,error_message=? WHERE source=?").bind(payload.code,payload.code,"Importación externa interrumpida",name));
      await env.DB.batch(statements);
      return reply({ ok: true });
    }
    return reply({ error: "Operación inválida." }, 400);
  } catch (error) { return reply({ error: error?.message === "TOO_LARGE" ? "Lote demasiado grande." : "No se pudo procesar." }, error?.message === "TOO_LARGE" ? 413 : 503); }
} };
export default worker;
