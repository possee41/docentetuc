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

async function store(db, items, owner) {
  const ids = items.map((item) => item.id);
  const existing = await db.prepare(`SELECT id, source, content_hash, removed_at, normalized_status FROM publications WHERE id IN (${ids.map(() => "?").join(",")})`).bind(...ids).all();
  if (existing.results.some((row) => row.source !== SOURCE)) throw new Error("SOURCE_CONFLICT");
  if (owner && existing.results.some((row) => row.normalized_status === "UNKNOWN")) throw new Error("PROTECTED_RECORD");
  const previous = new Map(existing.results.map((row) => [row.id, row]));
  const changes = items.filter((item) => {
    const prior = previous.get(item.id);
    return !prior || prior.content_hash !== item.contentHash || prior.removed_at !== null;
  });
  const now = new Date().toISOString();
  // Fence the write itself: a request admitted before expiry cannot write after
  // another execution acquires the lease. No additional table or round trip.
  const sql = owner ? UPSERT.replace(/VALUES \(([^\n]+)\)/, `SELECT $1 WHERE EXISTS (
    SELECT 1 FROM import_gate_lease WHERE id=1 AND source='fdci' AND opened_by=?
      AND julianday(expires_at)>julianday('now'))`)
    .replace("WHERE publications.source=", "WHERE publications.normalized_status<>'UNKNOWN' AND publications.source=") : UPSERT;
  const statements = changes.map((item) => db.prepare(sql).bind(
    item.id, item.externalId, item.category, item.title, item.summary, item.level, item.area,
    item.location, item.character, item.circuit, item.sourceCircuitRaw, item.circuitInferenceSource,
    item.circuitConfidence, item.startsAt, item.endsAt, item.status, item.officialUrl,
    item.metadata, item.contentHash, item.sourceUpdatedAt, item.registrationOpenAt,
    item.registrationCloseAt, item.expiresAt, item.status, item.normalizedStatus, now, now,
    ...(owner ? [owner] : []),
  ));
  const written = statements.length ? await db.batch(statements) : [];
  const applied = written.map((result) => Number(result.meta?.rows_written || 0) > 0);
  if (owner && applied.some((changed) => !changed)) throw new Error("LEASE_OR_CONCURRENT_CHANGE");
  return {
    received: items.length,
    created: changes.filter((item, index) => applied[index] && !previous.has(item.id)).length,
    updated: changes.filter((item, index) => applied[index] && previous.has(item.id)).length,
    unchanged: items.length - applied.filter(Boolean).length,
    queries: 1 + statements.length,
    rowsRead: Number(existing.meta?.rows_read || 0) + written.reduce((sum, result) => sum + Number(result.meta?.rows_read || 0), 0),
    rowsWritten: written.reduce((sum, result) => sum + Number(result.meta?.rows_written || 0), 0),
  };
}

const worker = {
  async fetch(request, env) {
    if (new URL(request.url).pathname !== "/api/internal/fdci-import") return reply({ error: "No encontrado." }, 404);
    if (request.method !== "POST") return reply({ error: "Método no permitido." }, 405);
    if (!env.FDCI_IMPORT_SECRET || !env.DB) return reply({ error: "Receptor no configurado." }, 503);
    if (!await authorized(request.headers.get("authorization"), env.FDCI_IMPORT_SECRET)) return reply({ error: "No autorizado." }, 401);
    // This gate stays off until legacy FDCI has been disabled and its in-flight runs have drained.
    if (env.FDCI_EXTERNAL_ENABLED !== "true") return reply({ error: "Importación no habilitada." }, 503);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) return reply({ error: "Se requiere JSON." }, 415);
    if (Number(request.headers.get("content-length") || 0) > MAX_BYTES) return reply({ error: "Lote demasiado grande." }, 413);
    let payload;
    try { payload = await readBody(request); }
    catch (error) { return reply({ error: error?.message === "TOO_LARGE" ? "Lote demasiado grande." : "JSON inválido." }, error?.message === "TOO_LARGE" ? 413 : 400); }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) return reply({ error: "Operación inválida." }, 400);
    try {
      const items = payload.items;
      if (payload.mode !== "batch" || !Array.isArray(items) || items.length < 1 || items.length > MAX_ITEMS || !items.every(valid) ||
          new Set(items.map((item) => item.id)).size !== items.length) return reply({ error: "Lote inválido." }, 400);
      const owner = env.IMPORT_GATE_LEASE_REQUIRED === "true" ? request.headers.get("x-import-gate-owner") : null;
      if (env.IMPORT_GATE_LEASE_REQUIRED === "true" && (!owner || !/^[A-Za-z0-9_:-]{1,100}$/.test(owner))) return reply({ error: "GATE_OWNER_INVALID" }, 409);
      if (owner && (items.length !== 1 || items.some((item) => item.id === "fdci:commission:6375" ||
          !item.id.startsWith("fdci:commission:") || item.normalizedStatus === "UNKNOWN"))) return reply({ error: "PROTECTED_RECORD" }, 422);
      return reply({ ok: true, ...await store(env.DB, items, owner) });
    } catch (error) {
      if (error?.message === "SOURCE_CONFLICT") return reply({ error: "Conflicto de fuente." }, 409);
      if (error?.message === "PROTECTED_RECORD") return reply({ error: "PROTECTED_RECORD" }, 422);
      if (error?.message === "LEASE_OR_CONCURRENT_CHANGE") return reply({ error: "LEASE_OR_CONCURRENT_CHANGE" }, 409);
      return reply({ error: "No se pudo guardar el lote." }, 503);
    }
  },
};

export default worker;
