// Called only after gateway authentication, identity and lease checks. Never accepts SQL.
const key = value => typeof value === "string" && /^\d{12}:\d{12}$/.test(value);
const fence = `EXISTS (SELECT 1 FROM import_gate_lease WHERE id=1 AND source='fdci'
  AND opened_by=? AND julianday(expires_at)>julianday('now'))`;
const reply = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function fdciCheckpoint(payload, db, owner) {
  if (!payload || !["get", "start", "advance", "finish"].includes(payload.op)) return reply({ error: "CHECKPOINT_INVALID" }, 400);
  try {
    if (payload.op === "get") {
      const state = await db.prepare("SELECT * FROM fdci_import_checkpoint WHERE id=1").first();
      return state ? reply({ ok: true, state }) : reply({ error: "CHECKPOINT_UNAVAILABLE" }, 503);
    }
    if (!Number.isSafeInteger(payload.revision) || payload.revision < 0) return reply({ error: "CHECKPOINT_INVALID" }, 400);
    let statement;
    if (payload.op === "start" && key(payload.upper)) {
      statement = db.prepare(`UPDATE fdci_import_checkpoint SET revision=revision+1,upper_key=?,after_key='',failures=0,last_error_code=NULL
        WHERE id=1 AND revision=? AND upper_key='' AND ${fence} RETURNING *`).bind(payload.upper, payload.revision, owner);
    } else if (payload.op === "advance" && key(payload.after) && typeof payload.failed === "boolean" &&
        (payload.failed ? /^FDCI_[A-Z_0-9]{1,60}$/.test(payload.code || "") : payload.code === null)) {
      statement = db.prepare(`UPDATE fdci_import_checkpoint SET revision=revision+1,after_key=?,failures=failures+?,
        last_error_code=CASE WHEN ? THEN ? ELSE last_error_code END
        WHERE id=1 AND revision=? AND upper_key<>'' AND after_key<? AND upper_key>=? AND ${fence} RETURNING *`)
        .bind(payload.after, Number(payload.failed), Number(payload.failed), payload.code, payload.revision, payload.after, payload.after, owner);
    } else if (payload.op === "finish") {
      statement = db.prepare(`UPDATE fdci_import_checkpoint SET revision=revision+1,cycle=cycle+1,upper_key='',after_key='',
        last_cycle_status=CASE WHEN failures=0 THEN 'OK' ELSE 'PARTIAL' END,
        last_completed_at=CASE WHEN failures=0 THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_completed_at END,failures=0
        WHERE id=1 AND revision=? AND upper_key<>'' AND ${fence} RETURNING *`).bind(payload.revision, owner);
    } else return reply({ error: "CHECKPOINT_INVALID" }, 400);
    const result = await statement.all();
    return result.results.length === 1 ? reply({ ok: true, state: result.results[0] }) : reply({ error: "CHECKPOINT_CONFLICT" }, 409);
  } catch { return reply({ error: "CHECKPOINT_UNAVAILABLE" }, 503); }
}
