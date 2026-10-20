// Standalone FDCI receiver. The GitHub runner prepares publications; this Worker only persists them.
const SOURCE = "Capacitación Docente";
const MAX_BYTES = 150_000;
const MAX_ITEMS = 5;
const TEXT_FIELDS = {
  externalId: 80, category: 120, title: 500, summary: 2000, level: 300,
  area: 300, location: 300, character: 300, status: 100, metadata: 6000,
  contentHash: 64, circuit: 20, sourceCircuitRaw: 300, circuitInferenceSource: 30,
};
const DATES = ["startsAt", "endsAt", "sourceUpdatedAt", "registrationOpenAt", "registrationCloseAt", "expiresAt"];
const UPSERT = `INSERT INTO publications
  (id, source, external_id, kind, category, title, summary, level, area, location, character,
   circuit, source_circuit_raw, circuit_inference_source, circuit_confidence,
   starts_at, ends_at, status, official_url, metadata, content_hash, source_updated_at,
   registration_open_at, registration_close_at, expires_at, source_status, normalized_status,
   last_seen_at, last_changed_at)
  VALUES (?, '${SOURCE}', ?, 'capacitacion', ${Array(25).fill("?").join(", ")})
  ON CONFLICT(id) DO UPDATE SET
    category=excluded.category, title=excluded.title, summary=excluded.summary, level=excluded.level,
    area=excluded.area, location=excluded.location, character=excluded.character, circuit=excluded.circuit,
    source_circuit_raw=excluded.source_circuit_raw, circuit_inference_source=excluded.circuit_inference_source,
    circuit_confidence=excluded.circuit_confidence, starts_at=excluded.starts_at, ends_at=excluded.ends_at,
    status=excluded.status, official_url=excluded.official_url, metadata=excluded.metadata,
    content_hash=excluded.content_hash, source_updated_at=excluded.source_updated_at,
    registration_open_at=excluded.registration_open_at, registration_close_at=excluded.registration_close_at,
    expires_at=excluded.expires_at, source_status=excluded.source_status,
    normalized_status=excluded.normalized_status, removed_at=NULL,
    last_seen_at=excluded.last_seen_at, last_changed_at=excluded.last_changed_at, updated_at=CURRENT_TIMESTAMP
  WHERE publications.source='${SOURCE}' AND
    (publications.content_hash<>excluded.content_hash OR publications.removed_at IS NOT NULL)`;

const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const text = (value, max) => typeof value === "string" && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const date = (value) => value === null || (text(value, 40) && Number.isFinite(Date.parse(value)));

async function authorized(header, secret) {
  const bearer = header?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/)?.[1];
  if (!secret || !bearer) return false;
  const hash = (value) => crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [expected, actual] = await Promise.all([hash(secret), hash(bearer)]);
  const left = new Uint8Array(expected), right = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left[i] ^ right[i];
  return difference === 0;
}

function valid(item) {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  if (!/^fdci:(?:course|commission):[A-Za-z0-9_-]{1,80}$/.test(item.id) ||
      Object.entries(TEXT_FIELDS).some(([key, max]) => !text(item[key], max)) ||
      !item.externalId || !item.title || item.id.split(":").at(-1) !== item.externalId ||
      !/^[a-f0-9]{64}$/.test(item.contentHash) ||
      !DATES.every((key) => date(item[key])) ||
      !Number.isInteger(item.circuitConfidence) || item.circuitConfidence < 0 || item.circuitConfidence > 100 ||
      !["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "UNKNOWN"].includes(item.normalizedStatus) ||
      !["UNKNOWN", "I", "II", "III", "IV", "V", "ALL", "MULTIPLE"].includes(item.circuit)) return false;
  try {
    const url = new URL(item.officialUrl);
    const metadata = JSON.parse(item.metadata);
    return url.protocol === "https:" && url.hostname === "capacitaciondocente.educaciontuc.gov.ar" &&
      !url.username && !url.password && metadata && typeof metadata === "object" && !Array.isArray(metadata) &&
      metadata.entity === (item.id.startsWith("fdci:commission:") ? "commission" : "course") &&
      Boolean(metadata.trainingId) &&
      (metadata.entity !== "commission" || String(metadata.commissionId) === item.externalId);
  } catch { return false; }
}

async function readBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_JSON");
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BYTES) { await reader.cancel(); throw new Error("TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_JSON"); }
}

async function store(db, items) {
  const ids = items.map((item) => item.id);
  const existing = await db.prepare(`SELECT id, source, content_hash, removed_at FROM publications WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  if (existing.results.some((row) => row.source !== SOURCE)) throw new Error("SOURCE_CONFLICT");
  const previous = new Map(existing.results.map((row) => [row.id, row]));
  const changes = items.filter((item) => {
    const prior = previous.get(item.id);
    return !prior || prior.content_hash !== item.contentHash || prior.removed_at !== null;
  });
  const now = new Date().toISOString();
  const statements = changes.map((item) => db.prepare(UPSERT).bind(
    item.id, item.externalId, item.category, item.title, item.summary, item.level, item.area,
    item.location, item.character, item.circuit, item.sourceCircuitRaw, item.circuitInferenceSource,
    item.circuitConfidence, item.startsAt, item.endsAt, item.status, item.officialUrl,
    item.metadata, item.contentHash, item.sourceUpdatedAt, item.registrationOpenAt,
    item.registrationCloseAt, item.expiresAt, item.status, item.normalizedStatus, now, now,
  ));
  const written = statements.length ? await db.batch(statements) : [];
  return {
    received: items.length, created: changes.filter((item) => !previous.has(item.id)).length,
    updated: changes.filter((item) => previous.has(item.id)).length, unchanged: items.length - changes.length,
    queries: 1 + statements.length,
    rowsRead: Number(existing.meta?.rows_read || 0) + written.reduce((sum, result) => sum + Number(result.meta?.rows_read || 0), 0),
    rowsWritten: written.reduce((sum, result) => sum + Number(result.meta?.rows_written || 0), 0),
  };
}

async function markRun(db, mode, count) {
  const now = new Date().toISOString();
  const complete = mode === "complete";
  const error = complete ? null : mode === "failed" ? "El importador externo no completó el recorrido." : "Importación externa en curso.";
  const result = await db.prepare(`INSERT INTO sync_state (source, synced_at, item_count, error, last_attempt_at, last_successful_sync_at, sync_status, error_code, error_message, parser_version)
    VALUES ('${SOURCE}', ?, ?, ?, ?, ?, ?, ?, ?, 'external-1')
    ON CONFLICT(source) DO UPDATE SET
      last_attempt_at=excluded.last_attempt_at, sync_status=excluded.sync_status, error=excluded.error,
      error_code=excluded.error_code, error_message=excluded.error_message,
      synced_at=CASE WHEN excluded.sync_status='OK' THEN excluded.synced_at ELSE sync_state.synced_at END,
      last_successful_sync_at=CASE WHEN excluded.sync_status='OK' THEN excluded.last_successful_sync_at ELSE sync_state.last_successful_sync_at END,
      item_count=CASE WHEN excluded.sync_status='OK' THEN excluded.item_count ELSE sync_state.item_count END`)
    .bind(now, count, error, now, complete ? now : null, complete ? "OK" : "PARTIAL",
      complete ? null : mode === "failed" ? "EXTERNAL_FAILED" : "IN_PROGRESS", error).run();
  return { queries: 1, rowsRead: Number(result.meta?.rows_read || 0), rowsWritten: Number(result.meta?.rows_written || 0) };
}

const worker = {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api/internal/fdci-import") return reply({ error: "No encontrado." }, 404);
    if (request.method !== "POST") return reply({ error: "Método no permitido." }, 405);
    if (!env.FDCI_IMPORT_SECRET || !env.DB) return reply({ error: "Receptor no configurado." }, 503);
    if (!await authorized(request.headers.get("authorization"), env.FDCI_IMPORT_SECRET)) return reply({ error: "No autorizado." }, 401);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Se requiere JSON." }, 415);
    if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return reply({ error: "Lote demasiado grande." }, 413);
    let payload;
    try { payload = await readBody(request); }
    catch (error) { return reply({ error: error?.message === "TOO_LARGE" ? "Lote demasiado grande." : "JSON inválido." }, error?.message === "TOO_LARGE" ? 413 : 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply({ error: "Operación inválida." }, 400);
    try {
      if (payload.mode === "batch") {
        const items = payload.items;
        if (!Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS || !items.every(valid) ||
            new Set(items.map((item) => item.id)).size !== items.length) return reply({ error: "Lote inválido." }, 400);
        return reply({ ok: true, ...await store(env.DB, items) });
      }
      if (payload.mode === "start" || payload.mode === "failed") return reply({ ok: true, ...await markRun(env.DB, payload.mode, 0) });
      if (payload.mode === "complete" && Number.isInteger(payload.count) && payload.count >= 0 && payload.count <= 100_000)
        return reply({ ok: true, ...await markRun(env.DB, "complete", payload.count) });
      return reply({ error: "Operación inválida." }, 400);
    } catch (error) {
      if (error?.message === "SOURCE_CONFLICT") return reply({ error: "Conflicto de fuente." }, 409);
      return reply({ error: "No se pudo guardar el lote." }, 503);
    }
  },
};

export default worker;
