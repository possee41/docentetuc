// Narrow checkpoint operations for the external Junta runner. Never accepts SQL from the caller.
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";

const roots = new Map(JUNTA_EXTERNAL_SOURCES.map(([id, category]) => [id, category]));
const categories = ["Padrones", "Comunicados", "Llamados abiertos"];
const validText = (value, max = 200) => typeof value === "string" && value.length > 0 && value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const validDate = (value) => validText(value, 40) && !Number.isNaN(Date.parse(value));
const root = (value) => roots.has(value);
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const operations = {
  prior: (db, [id]) => root(id) && db.prepare("SELECT status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(id),
  init: (db, [id, category, state]) => root(id) && roots.get(id) === category && validText(state, 100_000) &&
    db.prepare("INSERT OR IGNORE INTO juntas_import_checkpoint(root_id,category,state_json,status) VALUES(?,?,?,'PARTIAL')").bind(id, category, state),
  claim: (db, [owner, until, now, id, clock]) => root(id) && validText(owner, 80) && validDate(until) && validDate(now) && validDate(clock) &&
    db.prepare("UPDATE juntas_import_checkpoint SET lease_owner=?,lease_until=?,last_attempt_at=? WHERE root_id=? AND (lease_until IS NULL OR lease_until<=?)").bind(owner, until, now, id, clock),
  get: (db, [id]) => root(id) && db.prepare("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?").bind(id),
  save: (db, [state, status, complete, now, id, owner, clock]) => root(id) && validText(state, 100_000) &&
    ["OK", "PARTIAL"].includes(status) && [0, 1].includes(complete) && validDate(now) && validDate(clock) && validText(owner, 80) &&
    db.prepare("UPDATE juntas_import_checkpoint SET state_json=?,status=?,error_code=NULL,last_success_at=CASE WHEN ? THEN ? ELSE last_success_at END WHERE root_id=? AND lease_owner=? AND lease_until>?")
      .bind(state, status, complete, now, id, owner, clock),
  release: (db, [id, owner]) => root(id) && validText(owner, 80) &&
    db.prepare("UPDATE juntas_import_checkpoint SET lease_owner=NULL,lease_until=NULL WHERE root_id=? AND lease_owner=?").bind(id, owner),
  partial: (db, [code, id, owner]) => root(id) && /^JUNTAS_[A-Z_0-9]{1,70}$/.test(code || "") && validText(owner, 80) &&
    db.prepare("UPDATE juntas_import_checkpoint SET status='PARTIAL',error_code=? WHERE root_id=? AND lease_owner=?").bind(code, id, owner),
  signatures: (db, [id, ...fileIds]) => root(id) && fileIds.length > 0 && fileIds.length <= 25 && fileIds.every((file) => validText(file, 200)) &&
    db.prepare(`SELECT file_id,signature FROM juntas_import_applied WHERE root_id=? AND file_id IN (${fileIds.map(() => "?").join(",")})`).bind(id, ...fileIds),
  applied: (db, [id, file, signature]) => root(id) && validText(file, 200) && /^[a-f0-9]{64}$/.test(signature || "") &&
    db.prepare("INSERT INTO juntas_import_applied(root_id,file_id,signature) VALUES(?,?,?) ON CONFLICT(root_id,file_id) DO UPDATE SET signature=excluded.signature WHERE signature<>excluded.signature")
      .bind(id, file, signature),
  health: (db, args) => args.length === 0 && db.prepare("SELECT root_id,category,status,last_success_at,error_code FROM juntas_import_checkpoint ORDER BY root_id"),
  syncHealth: (db, args) => args.length === 0 && db.prepare("SELECT source,sync_status,last_successful_sync_at,error_code FROM sync_state WHERE source IN ('Padrones','Comunicados','Llamados abiertos')"),
  syncSave: (db, [category, attempt, success, status, code]) => categories.includes(category) && validDate(attempt) &&
    (success === null || validDate(success)) && ["OK", "PARTIAL"].includes(status) &&
    (code === null || code === "JUNTAS_PARTIAL_SOURCE") &&
    db.prepare(`INSERT INTO sync_state(source,synced_at,item_count,last_attempt_at,last_successful_sync_at,sync_status,error_code)
      VALUES(?,'',0,?,?,?,?) ON CONFLICT(source) DO UPDATE SET
      last_attempt_at=excluded.last_attempt_at,last_successful_sync_at=excluded.last_successful_sync_at,
      sync_status=excluded.sync_status,error_code=excluded.error_code`).bind(category, attempt, success, status, code),
};
const reads = new Set(["prior", "get", "signatures", "health", "syncHealth"]);
const firsts = new Set(["prior", "get"]);
const arity = { prior: 1, init: 3, claim: 5, get: 1, save: 7, release: 2, partial: 3,
  applied: 3, health: 0, syncHealth: 0, syncSave: 5 };
async function readBody(request) {
  if (Number(request.headers.get("content-length") || 0) > 100_000) throw new Error("TOO_LARGE");
  const reader = request.body?.getReader();
  if (!reader) throw new Error("INVALID_REQUEST");
  const chunks = []; let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 100_000) { await reader.cancel(); throw new Error("TOO_LARGE"); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
  catch { throw new Error("INVALID_REQUEST"); }
}

const worker = { async fetch(request, env) {
  if (request.method !== "POST" || !request.headers.get("content-type")?.startsWith("application/json")) return reply({ error: "INVALID_REQUEST" }, 400);
  let payload;
  try { payload = await readBody(request); }
  catch (error) { return reply({ error: error?.message === "TOO_LARGE" ? "TOO_LARGE" : "INVALID_REQUEST" },
    error?.message === "TOO_LARGE" ? 413 : 400); }
  const { op, args } = payload || {};
  if (!Object.hasOwn(operations, op) || !Array.isArray(args) ||
      (op === "signatures" ? args.length < 2 || args.length > 26 : args.length !== arity[op]))
    return reply({ error: "INVALID_OPERATION" }, 400);
  try {
    const statement = operations[op](env.DB, args);
    if (!statement) return reply({ error: "INVALID_ARGUMENTS" }, 400);
    const result = reads.has(op) ? firsts.has(op) ? await statement.first() : await statement.all() : await statement.run();
    return reply({ ok: true, result: reads.has(op) ? result : { meta: result.meta } });
  } catch { return reply({ error: "D1_OPERATION_FAILED" }, 503); }
} };
export default worker;
