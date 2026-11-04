// Narrow automation facade over the existing FDCI gateway; never accepts SQL.
const prefix = "/api/internal/fdci-automation/";
const reply = (status, error) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const live = row => row && Date.parse(row.lease_until) > Date.now();
const operations = new Set(["identity", "start", "close", "finish", "import", "checkpoint", "delta"]);

export async function suspendAutomation(db, owner, reason) {
  await db.batch([
    db.prepare("UPDATE fdci_automation_control SET status='HALTED',halt_reason=? WHERE id=1 AND owner=?")
      .bind(reason, owner),
    db.prepare("UPDATE import_gate_lease SET expires_at=? WHERE id=1 AND source='fdci' AND opened_by=?")
      .bind(new Date().toISOString(), owner),
  ]);
}

export async function automationRequest(request, env, authorized, delegate) {
  // These guards close before D1 access. Existing pilot flags/secrets are untouched.
  if (env.FDCI_AUTOMATION_ENABLED !== "true" || !env.DB || !env.FDCI_AUTOMATION_SECRET ||
      env.FDCI_AUTOMATION_SECRET === env.FDCI_IMPORT_SECRET ||
      env.IMPORT_GATE_ALLOWED_SOURCE !== "fdci") return reply(503, "AUTOMATION_DISABLED");
  const url = new URL(request.url), op = url.pathname.slice(prefix.length);
  if (op === "delta" && env.FDCI_DELTA_ENABLED !== "true") return reply(503, "DELTA_DISABLED");
  if (!operations.has(op) || url.search || request.method !== (op === "identity" ? "GET" : "POST"))
    return reply(404, "AUTOMATION_OPERATION_FORBIDDEN");
  if (!await authorized(request.headers.get("authorization"), env.FDCI_AUTOMATION_SECRET)) return reply(401, "UNAUTHORIZED");
  const owner = request.headers.get("x-import-gate-owner");
  const sha = request.headers.get("x-fdci-automation-sha");
  if (!/^\d{1,20}-1$/.test(owner || "") || !/^[a-f0-9]{40}$/.test(sha || "")) return reply(403, "AUTOMATION_IDENTITY_INVALID");
  let state;
  try {
    state = await env.DB.prepare("SELECT * FROM fdci_automation_control WHERE id=1").first();
    const from = Date.parse(state?.not_before), until = Date.parse(state?.not_after), now = Date.now();
    if (!state || state.approved_sha !== sha || !Number.isFinite(from) || !Number.isFinite(until) ||
        from % 7_200_000 !== 0 || until - from > 86_400_000 || until <= from || now < from || now >= until)
      return reply(503, "AUTOMATION_WINDOW_CLOSED");
    if (state.status === "HALTED") return op === "finish" && state.owner === owner
      ? Response.json({ ok: true, halted: true }) : reply(503, "AUTOMATION_HALTED");
    if (state.status === "RUNNING" && !live(state)) {
      await suspendAutomation(env.DB, state.owner, "UNFINISHED_EXECUTION");
      return reply(503, "AUTOMATION_HALTED");
    }
    // Verify the physical DB using the existing authenticated identity operation.
    const scopedEnv = { ...env, FDCI_IMPORT_SECRET: env.FDCI_AUTOMATION_SECRET,
      IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true", FDCI_EXTERNAL_ENABLED: "true" };
    const headers = new Headers(request.headers);
    const forward = async (path, body) => delegate(new Request(new URL(path, url), {
      method: body === undefined ? "GET" : "POST", headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }), scopedEnv);
    if (op === "identity") return forward("/api/internal/import-identity?source=fdci");
    if (Number(request.headers.get("content-length") || 0) > 150_000) return reply(413, "AUTOMATION_BODY_TOO_LARGE");
    // Read through a bounded stream; content-length is not trusted.
    const reader = request.body?.getReader(); let raw = "", size = 0;
    if (!reader) return reply(400, "AUTOMATION_JSON_REQUIRED");
    const decoder = new TextDecoder("utf-8", { fatal: true });
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 150_000) { await reader.cancel(); return reply(413, "AUTOMATION_BODY_TOO_LARGE"); }
      raw += decoder.decode(value, { stream: true });
    }
    let body; try { body = JSON.parse(raw + decoder.decode()); } catch { return reply(400, "AUTOMATION_JSON_INVALID"); }
    if (op === "start") {
      if (body.source !== "fdci" || body.owner !== owner || body.action !== "open" ||
          !Number.isInteger(body.ttlSeconds) || body.ttlSeconds < 60 || body.ttlSeconds > 600)
        return reply(400, "FDCI_TTL_OR_SOURCE_INVALID");
      if (state.status === "RUNNING") return state.owner === owner
        ? Response.json({ ok: true, source: "fdci", owner, expiresAt: state.lease_until }) : reply(409, "GATE_BUSY");
      const slot = Math.floor(now / 7_200_000);
      if (state.last_slot >= slot) return reply(409, "AUTOMATION_SLOT_USED");
      const identity = await forward("/api/internal/import-identity?source=fdci");
      if (!identity.ok) return identity;
      const grant = crypto.randomUUID(), expires = new Date(Math.min(now + body.ttlSeconds * 1000, until)).toISOString();
      const opened = new Date(now).toISOString();
      const result = await env.DB.batch([
        env.DB.prepare(`UPDATE fdci_automation_control SET status='RUNNING',owner=?,grant_id=?,lease_until=?,
          last_slot=?,publication_attempts=0,last_result=NULL WHERE id=1 AND status='IDLE' AND last_slot<?
          AND NOT EXISTS(SELECT 1 FROM import_gate_lease WHERE julianday(expires_at)>julianday(?))`)
          .bind(owner, grant, expires, slot, slot, opened),
        env.DB.prepare(`INSERT INTO import_gate_lease(id,source,expires_at,opened_at,opened_by)
          SELECT 1,'fdci',?,?,? WHERE EXISTS(SELECT 1 FROM fdci_automation_control WHERE id=1 AND grant_id=?)
          ON CONFLICT(id) DO UPDATE SET source=excluded.source,expires_at=excluded.expires_at,
          opened_at=excluded.opened_at,opened_by=excluded.opened_by WHERE julianday(import_gate_lease.expires_at)<=julianday(?)`)
          .bind(expires, opened, owner, grant, opened),
      ]);
      if (result.some(x => Number(x.meta?.changes) !== 1)) return reply(409, "GATE_BUSY");
      return Response.json({ ok: true, source: "fdci", owner, expiresAt: expires });
    }
    if (state.owner !== owner) return reply(409, "GATE_OWNER_MISMATCH");
    if (op === "finish") {
      const success = body.success === true;
      const reason = /^[A-Z_0-9]{1,70}$/.test(body.reason || "") ? body.reason : "IMPORT_FAILED";
      if (!success) { await suspendAutomation(env.DB, owner, reason); return Response.json({ ok: true, halted: true }); }
      if (state.status !== "RUNNING" || !live(state)) return reply(409, "AUTOMATION_NOT_RUNNING");
      const result = await env.DB.prepare(`UPDATE fdci_automation_control SET status='IDLE',last_result=?
        WHERE id=1 AND owner=? AND status='RUNNING'
        AND NOT EXISTS(SELECT 1 FROM import_gate_lease WHERE source='fdci' AND opened_by=? AND julianday(expires_at)>julianday('now'))`)
        .bind(reason, owner, owner).run();
      return Number(result.meta?.changes) === 1 ? Response.json({ ok: true, halted: false }) : reply(409, "LEASE_STILL_ACTIVE");
    }
    if (state.status !== "RUNNING" || !live(state)) return reply(503, "AUTOMATION_NO_LEASE");
    if (op === "close") {
      if (body.source !== "fdci" || body.action !== "close" || body.owner !== owner) return reply(400, "AUTOMATION_CLOSE_INVALID");
      return forward("/api/internal/import-gate", body);
    }
    if (op === "import") {
      if (body.mode !== "batch" || !Array.isArray(body.items) || body.items.length !== 1) return reply(400, "AUTOMATION_BATCH_INVALID");
      const quota = await env.DB.prepare(`UPDATE fdci_automation_control SET publication_attempts=publication_attempts+1
        WHERE id=1 AND status='RUNNING' AND owner=? AND publication_attempts<2
        AND julianday(lease_until)>julianday('now')`).bind(owner).run();
      if (Number(quota.meta?.changes) !== 1) { await suspendAutomation(env.DB, owner, "PUBLICATION_LIMIT"); return reply(409, "PUBLICATION_LIMIT"); }
    }
    const response = await forward(op === "import" ? "/api/internal/fdci-import" :
      op === "delta" ? "/api/internal/fdci-delta" : "/api/internal/fdci-checkpoint", body);
    if (!response.ok) await suspendAutomation(env.DB, owner, "GATEWAY_HTTP_ERROR");
    return response;
  } catch {
    // If D1 cannot persist the halt, RUNNING remains latched; expiry fences writes
    // and the next start will halt after recovery, never silently resume.
    try { if (state?.owner === owner) await suspendAutomation(env.DB, owner, "D1_OR_RESPONSE_ERROR"); } catch { /* fail closed */ }
    return reply(503, "AUTOMATION_STORAGE_UNAVAILABLE");
  }
}
