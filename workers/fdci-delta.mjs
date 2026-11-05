// Called only after gateway identity, authentication and owner/lease checks.
import { validFdciPrepared } from "./fdci-receiver.mjs";
const source = "Capacitación Docente";
const validId = id => typeof id === "string" && /^fdci:commission:[1-9]\d{0,11}$/.test(id);
const live = `EXISTS(SELECT 1 FROM import_gate_lease WHERE id=1 AND source='fdci'
  AND opened_by=? AND julianday(expires_at)>julianday('now'))`;
const reply = (value, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });

export async function fdciDelta(body, db, owner) {
  if (!body || typeof body !== "object") return reply({ error: "DELTA_INVALID" }, 400);
  try {
    const state = () => db.prepare("SELECT revision,last_staged_id,last_complete_scan_at,detail_after,detail_upper,detail_cycle FROM fdci_delta_state WHERE id=1").first();
    if (body.op === "state") return reply({ ok: true, state: await state() });
    if (body.op === "snapshot") {
      for (const key of ["after", "queuedAfter"])
        if (body[key] !== null && (typeof body[key] !== "string" || body[key] !== "" && !validId(body[key])))
          return reply({ error: "DELTA_INVALID" }, 400);
      // Every page carries the revision observed BEFORE its reads. Subsequent CAS
      // rejects mutations if another scan changed it; no extra final state request.
      const current = await state();
      const queued = body.queuedAfter === null ? [] : (await db.prepare(`SELECT seq,publication_id AS id,content_hash
        FROM fdci_delta_queue WHERE publication_id>? ORDER BY publication_id LIMIT 201`).bind(body.queuedAfter).all()).results;
      // Preserve the old 200-hash response ceiling across BOTH lists, rather
      // than doubling serialization work when the queue is large.
      const limit = 200 - Math.min(queued.length, 200);
      const confirmed = body.after === null || !limit ? [] : (await db.prepare(`SELECT id,content_hash,removed_at,normalized_status
        FROM publications WHERE source=? AND id>? AND id LIKE 'fdci:commission:%' ORDER BY id LIMIT ?`)
        .bind(source, body.after, limit + 1).all()).results;
      return reply({ ok: true, state: current, confirmed: confirmed.slice(0, limit), queued: queued.slice(0, 200),
        confirmedMore: body.after !== null && (!limit || confirmed.length > limit), queuedMore: queued.length > 200 });
    }
    if (["confirmed", "queued"].includes(body.op)) {
      if (typeof body.after !== "string" || body.after !== "" && !validId(body.after)) return reply({ error: "DELTA_INVALID" }, 400);
      const query = body.op === "confirmed"
        ? "SELECT id,content_hash,removed_at,normalized_status FROM publications WHERE source=? AND id>? AND id LIKE 'fdci:commission:%' ORDER BY id LIMIT 200"
        : "SELECT seq,publication_id AS id,content_hash FROM fdci_delta_queue WHERE publication_id>? ORDER BY publication_id LIMIT 200";
      const rows = await db.prepare(query).bind(...(body.op === "confirmed" ? [source, body.after] : [body.after])).all();
      return reply({ ok: true, rows: rows.results });
    }
    if (body.op === "head") {
      if (!Array.isArray(body.ids) || body.ids.length < 1 || body.ids.length > 2 ||
          new Set(body.ids).size !== body.ids.length || body.ids.some(id => !validId(id)))
        return reply({ error: "DELTA_INVALID" }, 400);
      const rows = await db.prepare(`SELECT seq,publication_id AS id,content_hash,payload,version FROM fdci_delta_queue
        WHERE publication_id IN (${body.ids.map(() => "?").join(",")}) ORDER BY seq LIMIT 2`).bind(...body.ids).all();
      return reply({ ok: true, rows: rows.results });
    }
    if (!["stage", "scan-complete", "ack"].includes(body.op) || !Number.isSafeInteger(body.revision) || body.revision < 0)
      return reply({ error: "DELTA_INVALID" }, 400);
    const token = crypto.randomUUID();
    const tokenFence = "EXISTS(SELECT 1 FROM fdci_delta_state WHERE id=1 AND stage_token=? AND stage_owner=?)";
    let extra = "", args = [], statements = [];
    if (body.op === "stage") {
      if (!Array.isArray(body.items) || body.items.length < 1 || body.items.length > 2 ||
          new Set(body.items.map(x => x?.id)).size !== body.items.length || body.items.some(x =>
            !validFdciPrepared(x) || !validId(x.id) || x.id === "fdci:commission:6375" || x.normalizedStatus === "UNKNOWN"))
        return reply({ error: "DELTA_INVALID" }, 400);
      const ids = body.items.map(x => x.id);
      const admission = await db.prepare(`SELECT EXISTS(SELECT 1 FROM publications
        WHERE id IN (${ids.map(() => "?").join(",")}) AND (source<>? OR normalized_status='UNKNOWN')) AS protected_record,
        (SELECT COUNT(*) FROM fdci_delta_queue) +
        (SELECT COUNT(*) FROM json_each(?) AS candidate WHERE NOT EXISTS
          (SELECT 1 FROM fdci_delta_queue WHERE publication_id=candidate.value)) AS total`).bind(...ids, source, JSON.stringify(ids)).first();
      if (![0, 1].includes(Number(admission?.protected_record))) throw new Error("DELTA_CAPACITY_INVALID");
      if (Number(admission.protected_record) === 1) return reply({ error: "PROTECTED_RECORD" }, 422);
      if (!Number.isSafeInteger(Number(admission?.total)) || Number(admission.total) < 0) throw new Error("DELTA_CAPACITY_INVALID");
      if (Number(admission.total) > 1000) return reply({ error: "DELTA_QUEUE_FULL" }, 409);
      extra = ",last_staged_id=?"; args = [ids.at(-1)];
      statements = body.items.map(item => db.prepare(`INSERT INTO fdci_delta_queue(publication_id,content_hash,payload)
        SELECT ?,?,? WHERE ${tokenFence}
        ON CONFLICT(publication_id) DO UPDATE SET content_hash=excluded.content_hash,payload=excluded.payload,version=fdci_delta_queue.version+1
        WHERE fdci_delta_queue.content_hash<>excluded.content_hash`)
        .bind(item.id, item.contentHash, JSON.stringify(item), token, owner));
    } else if (body.op === "scan-complete") {
      const detail = body.detail;
      if (detail !== undefined) {
        const key = value => typeof value === "string" && (value === "" || /^\d{12}$/.test(value));
        if (!detail || !key(detail.after) || !key(detail.upper) || detail.after > detail.upper || typeof detail.complete !== "boolean")
          return reply({ error: "DELTA_DETAIL_INVALID" }, 400);
        const current = await state();
        if (!current || current.detail_upper && current.detail_upper !== detail.upper || detail.after < current.detail_after)
          return reply({ error: "DELTA_CONFLICT" }, 409);
        extra = `,last_staged_id='',detail_after=?,detail_upper=?,detail_cycle=detail_cycle+?,
          last_complete_scan_at=CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE last_complete_scan_at END`;
        args = [detail.complete ? "" : detail.after, detail.complete ? "" : detail.upper, Number(detail.complete), Number(detail.complete)];
      } else extra = ",last_complete_scan_at=strftime('%Y-%m-%dT%H:%M:%fZ','now'),last_staged_id=''";
    } else {
      if (!validId(body.id) || !/^[a-f0-9]{64}$/.test(body.hash || "") || !Number.isSafeInteger(body.version) || body.version < 1)
        return reply({ error: "DELTA_INVALID" }, 400);
      extra = ` AND EXISTS(SELECT 1 FROM publications WHERE id=? AND source=? AND content_hash=? AND removed_at IS NULL)
        AND EXISTS(SELECT 1 FROM fdci_delta_queue WHERE publication_id=? AND content_hash=? AND version=?)`;
      args = [body.id, source, body.hash, body.id, body.hash, body.version];
      statements = [db.prepare(`DELETE FROM fdci_delta_queue WHERE publication_id=? AND content_hash=? AND version=? AND ${tokenFence}`)
        .bind(body.id, body.hash, body.version, token, owner)];
    }
    // Admission checks lease + CAS once at transaction start. The server-only token
    // fences all dependent statements in the SAME D1 transaction; no interleaving.
    const update = body.op === "ack"
      ? db.prepare(`UPDATE fdci_delta_state SET revision=revision+1,stage_token=?,stage_owner=? WHERE id=1 AND revision=? AND ${live}${extra}`)
        .bind(token, owner, body.revision, owner, ...args)
      : db.prepare(`UPDATE fdci_delta_state SET revision=revision+1,stage_token=?,stage_owner=?${extra} WHERE id=1 AND revision=? AND ${live}`)
        .bind(token, owner, ...args, body.revision, owner);
    const results = await db.batch([update, ...statements]);
    if (Number(results[0].meta?.changes) !== 1) return reply({ error: "DELTA_CONFLICT" }, 409);
    return reply({ ok: true, state: await state() });
  } catch { return reply({ error: "DELTA_STORAGE_UNAVAILABLE" }, 503); }
}
