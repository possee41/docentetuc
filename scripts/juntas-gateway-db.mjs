// Compatibility shim for the existing incremental checkpoint algorithm.
// Only these known statements can cross the gateway; SQL itself is never sent.
const statement = (sql) => sql.replace(/\s+/g, " ").trim();
const operation = (sql) => {
  const s = statement(sql);
  if (s.startsWith("SELECT status,last_success_at FROM juntas_import_checkpoint")) return "prior";
  if (s.startsWith("INSERT OR IGNORE INTO juntas_import_checkpoint")) return "init";
  if (s.startsWith("UPDATE juntas_import_checkpoint SET lease_owner=?")) return "claim";
  if (s.startsWith("SELECT state_json,status,last_success_at FROM juntas_import_checkpoint")) return "get";
  if (s.startsWith("UPDATE juntas_import_checkpoint SET state_json=?")) return "save";
  if (s.startsWith("UPDATE juntas_import_checkpoint SET lease_owner=NULL")) return "release";
  if (s.startsWith("UPDATE juntas_import_checkpoint SET status='PARTIAL'")) return "partial";
  if (s.startsWith("SELECT file_id,signature FROM juntas_import_applied")) return "signatures";
  if (s.startsWith("INSERT INTO juntas_import_applied")) return "applied";
  if (s.startsWith("SELECT root_id,category,status,last_success_at,error_code FROM juntas_import_checkpoint")) return "health";
  if (s.startsWith("SELECT source,sync_status,last_successful_sync_at,error_code FROM sync_state")) return "syncHealth";
  if (s.startsWith("INSERT INTO sync_state(source,synced_at,item_count,last_attempt_at,last_successful_sync_at,sync_status,error_code)")) return "syncSave";
  throw new Error("JUNTAS_GATEWAY_SQL_FORBIDDEN");
};

export function createJuntasGatewayDb(target, fetcher = fetch) {
  const counters = { queries: 0, rowsRead: 0, rowsWritten: 0 };
  const call = async (op, args) => {
    let response;
    try { response = await fetcher(`${target.origin}/api/internal/juntas-checkpoint`, {
      method: "POST", headers: { Authorization: `Bearer ${target.secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ op, args }), signal: AbortSignal.timeout(20_000),
    }); } catch { throw new Error("JUNTAS_GATEWAY_UNAVAILABLE"); }
    if (!response.ok) throw new Error(`JUNTAS_GATEWAY_HTTP_${response.status}`);
    let payload;
    try { payload = await response.json(); } catch { throw new Error("JUNTAS_GATEWAY_ACK_INVALID"); }
    if (payload?.ok !== true || !Object.hasOwn(payload, "result")) throw new Error("JUNTAS_GATEWAY_ACK_INVALID");
    const result = payload.result;
    const meta = result?.meta || {};
    counters.queries++;
    counters.rowsRead += Number(meta.rows_read || 0);
    counters.rowsWritten += Number(meta.rows_written || meta.changes || 0);
    return result;
  };
  return { metrics: () => ({ ...counters }), prepare: (sql) => {
    const op = operation(sql);
    return { bind: (...args) => ({
      all: async () => { const result = await call(op, args); if (!Array.isArray(result?.results)) throw new Error("JUNTAS_GATEWAY_ACK_INVALID"); return result; },
      first: async () => { const result = await call(op, args); counters.rowsRead += Number(Boolean(result)); return result; },
      run: () => call(op, args),
    }) };
  } };
}
