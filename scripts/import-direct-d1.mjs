// Opt-in pilot runner. Keep workflows on their isolated receivers until the
// D1 REST path and source cutover are explicitly approved.
import { pathToFileURL } from "node:url";
import { createD1Rest } from "./d1-rest.mjs";
import { CANARY_DATABASE_ID, CANARY_DATABASE_NAME } from "./probe-d1-rest-canary.mjs";
import { createDirectD1ReceiverFetch, sourceHashCache, withSourceHashCache } from "./direct-d1-receiver.mjs";
import { runFdciImport } from "./import-fdci.mjs";
import { runSimeImport } from "./import-sime.mjs";
import { runPublicSourceImport } from "./import-public-sources.mjs";
import { runJuntasCheckpoint } from "./import-juntas-checkpoint.mjs";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";

/** @param {{source: string, db: any, sourceFetch?: typeof fetch, driveKey?: string, selection?: {token: string, slug: string, commissionId: string}, scope?: string}} options */
export async function runDirectD1Import({ source, db, sourceFetch = fetch, driveKey, selection, scope = "single",
  juntaRootId, juntaMaxRequests, juntaMaxPublicationWrites }) {
  if (source === "juntas" && scope === "checkpoint") {
    const roots = juntaRootId ? JUNTA_EXTERNAL_SOURCES.filter(([id]) => id === juntaRootId) : JUNTA_EXTERNAL_SOURCES;
    if (!roots.length) throw new Error("JUNTAS_ROOT_INVALID");
    return { source, ...await runJuntasCheckpoint({ db, driveKey, sourceFetch, sources: roots,
      maxRequests: juntaMaxRequests ?? 25, maxPublicationWrites: juntaMaxPublicationWrites ?? 20 }) };
  }
  const storageSource = { sime: "SIME", juntas: "Padrones y Comunicados", cenet: "CeNET / INET", infd: "INFoD / AulaS-TIC" }[source];
  // A paginated, public-only hash snapshot avoids one D1 read per unchanged row.
  // FDCI's single-commission pilot is cheaper with its normal one-row lookup.
  const receiverDb = storageSource ? withSourceHashCache(db, await sourceHashCache(db, storageSource)) : db;
  const receiver = createDirectD1ReceiverFetch(receiverDb);
  const path = source === "fdci" ? "/api/internal/fdci-import" : source === "sime" ? "/api/internal/sime-import" :
    `/api/internal/public-source-import/${source}`;
  const endpoint = receiver.endpoint(path);
  let result;
  if (source === "fdci") {
    if (scope === "single" && !selection) throw new Error("FDCI_SELECTION_REQUIRED");
    const fetcher = (input, init) => String(input).startsWith("https://direct-d1.invalid/") ?
      receiver.receiverFetch(input, init) : sourceFetch(input, init);
    if (scope === "full") await db.prepare("INSERT INTO sync_state(source,synced_at,item_count,last_attempt_at,sync_status) VALUES('Capacitación Docente','',0,?,'PARTIAL') ON CONFLICT(source) DO UPDATE SET last_attempt_at=excluded.last_attempt_at,sync_status='PARTIAL'").bind(new Date().toISOString()).run();
    try {
      result = await runFdciImport({ endpoint, token: receiver.token, fetcher, scope, selection });
      if (scope === "full") {
        const finishedAt = new Date().toISOString();
        await db.prepare("UPDATE sync_state SET synced_at=?,last_successful_sync_at=?,sync_status='OK',error=NULL,error_code=NULL,error_message=NULL,item_count=? WHERE source='Capacitación Docente'").bind(finishedAt, finishedAt, result.discovered).run();
      }
    } catch (error) {
      if (scope === "full") {
        try { await db.prepare("UPDATE sync_state SET sync_status=?,error_code=?,error_message='Importación externa incompleta' WHERE source='Capacitación Docente'")
          .bind(error instanceof Error && error.message === "FDCI_PARTIAL_SOURCE" ? "PARTIAL" : "ERROR",
            error instanceof Error && error.message === "FDCI_PARTIAL_SOURCE" ? "FDCI_PARTIAL_SOURCE" : "EXTERNAL_IMPORT_FAILED").run(); } catch { /* Preserve the import failure. */ }
      }
      throw error;
    }
  } else if (source === "sime") {
    result = await runSimeImport({ endpoint, token: receiver.token, sourceFetch, receiverFetch: receiver.receiverFetch });
  } else if (["juntas", "cenet", "infd"].includes(source)) {
    result = await runPublicSourceImport({ source, endpoint, token: receiver.token, sourceFetch,
      receiverFetch: receiver.receiverFetch, driveKey });
  } else throw new Error("SOURCE_INVALID");
  return { source, ...result, d1: db.metrics?.() };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.DIRECT_D1_WRITE_ENABLED !== "true") throw new Error("DIRECT_D1_WRITE_DISABLED");
    if (process.env.D1_DATABASE_ID) throw new Error("CANARY_DATABASE_OVERRIDE_FORBIDDEN");
    const accountId = process.env.CF_ACCOUNT_ID, token = process.env.D1_IMPORT_TOKEN;
    const source = process.env.SYNC_SOURCE || "";
    const scope = source === "juntas" ? process.env.JUNTAS_SCOPE || "single" : process.env.FDCI_SCOPE || "single";
    // The D1 REST endpoint shares Cloudflare's account API rate limit.
    const db = createD1Rest({ accountId, databaseId: CANARY_DATABASE_ID, token,
      minRequestIntervalMs: source === "juntas" && scope === "checkpoint" ? 350 : 0 });
    const identity = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${CANARY_DATABASE_ID}`,
      { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (!identity.ok) throw new Error(`CANARY_IDENTITY_HTTP_${identity.status}`);
    const body = await identity.json();
    if (body?.success !== true || body.result?.uuid !== CANARY_DATABASE_ID || body.result?.name !== CANARY_DATABASE_NAME)
      throw new Error("CANARY_IDENTITY_MISMATCH");
    const selection = source === "fdci" && scope === "single" ? { token: process.env.FDCI_COURSE_TOKEN || "",
      slug: process.env.FDCI_COURSE_SLUG || "", commissionId: process.env.FDCI_COMMISSION_ID || "" } : undefined;
    const result = await runDirectD1Import({ source, db, driveKey: process.env.GOOGLE_DRIVE_API_KEY, selection, scope,
      juntaRootId: process.env.JUNTAS_ROOT_ID,
      juntaMaxRequests: process.env.JUNTAS_MAX_REQUESTS ? Number(process.env.JUNTAS_MAX_REQUESTS) : undefined,
      juntaMaxPublicationWrites: process.env.JUNTAS_MAX_PUBLICATION_WRITES ? Number(process.env.JUNTAS_MAX_PUBLICATION_WRITES) : undefined });
    console.log(JSON.stringify(result));
  } catch (error) {
    // Never include remote response bodies, URLs with tokens, or credentials.
    console.error("DIRECT_D1_IMPORT_FAILED", error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "unknown");
    process.exitCode = 1;
  }
}
