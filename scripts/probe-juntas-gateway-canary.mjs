// Two bounded phases, explicitly invoked one at a time. No official Drive calls.
import { resolveGatewayConfig, runGatewayImport, verifyGatewayIdentity } from "./import-via-gateway.mjs";
import { createJuntasGatewayDb } from "./juntas-gateway-db.mjs";

const phase = process.argv[2];
if (!["identity", "first", "resume"].includes(phase)) throw new Error("CANARY_PHASE_INVALID");
const config = {
  SYNC_SOURCE: "juntas", IMPORT_GATEWAY_TARGET: "canary",
  IMPORT_GATEWAY_ORIGIN: "https://docentetuc-import-canary-1-2.possee41.workers.dev/",
  IMPORT_GATEWAY_DATABASE_ID: "853e2f5d-89b1-46a3-9c1c-5cbd46784756",
  IMPORT_GATEWAY_DATABASE_NAME: "docentetuc-web-canary-1-2",
  JUNTAS_IMPORT_SECRET: process.env.JUNTAS_IMPORT_SECRET,
  JUNTA_ROOT_ID: "abiertos-primaria", GOOGLE_DRIVE_API_KEY: "synthetic-canary-key",
  JUNTAS_MAX_REQUESTS: "1", JUNTAS_MAX_PUBLICATION_WRITES: "1",
};
const files = ["dtcanary20261028a", "dtcanary20261028b"].map((id, index) => ({
  id, name: `PRUEBA CANARY · referencia ${index + 1}`, mimeType: "application/pdf",
  modifiedTime: "2026-10-28T00:00:00Z",
}));
const sourceFetch = async (input) => {
  if (phase !== "first") throw new Error("CANARY_UNEXPECTED_SOURCE_FETCH");
  const url = new URL(input);
  if (url.origin !== "https://www.googleapis.com" || url.pathname !== "/drive/v3/files")
    throw new Error("CANARY_UNEXPECTED_SOURCE_FETCH");
  return Response.json({ files });
};

let lastRequest = 0;
const receiverFetch = async (input, init) => {
  const target = resolveGatewayConfig(config);
  if (new URL(input).origin !== target.origin) throw new Error("CANARY_TARGET_INVALID");
  const remaining = 1300 - (Date.now() - lastRequest);
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  lastRequest = Date.now();
  return fetch(input, init);
};

try {
  const target = resolveGatewayConfig(config);
  if (phase === "identity") {
    await verifyGatewayIdentity(target, receiverFetch);
    console.log("CANARY_JUNTAS_IDENTITY_OK");
    process.exit(0);
  }
  const started = new Date().toISOString();
  const result = await runGatewayImport(target, config, sourceFetch, receiverFetch);
  const state = await createJuntasGatewayDb(target, receiverFetch).prepare(
    "SELECT state_json,status,last_success_at FROM juntas_import_checkpoint WHERE root_id=?")
    .bind("abiertos-primaria").first();
  const checkpoint = JSON.parse(state?.state_json || "null");
  if (result.created !== 1 || result.updated !== 0 || result.publicationAttempts !== 1 ||
      (phase === "first" && (state?.status !== "PARTIAL" || checkpoint?.page?.index !== 1)) ||
      (phase === "resume" && (state?.status !== "OK" || result.sourceRequests !== 0 || checkpoint?.queue?.length !== 0)))
    throw new Error("CANARY_RESULT_INVALID");
  console.log(JSON.stringify({ synthetic: true, phase, started, ended: new Date().toISOString(),
    created: result.created, updated: result.updated, unchanged: result.unchanged,
    sourceRequests: result.sourceRequests, publicationAttempts: result.publicationAttempts,
    checkpoint: { status: state.status, pageIndex: checkpoint?.page?.index ?? null,
      pendingFolders: checkpoint?.queue?.length ?? null }, publicationD1: {
      queries: result.queries, rowsRead: result.rowsRead, rowsWritten: result.rowsWritten },
    checkpointD1: result.d1, completed: result.completed }));
} catch (error) {
  console.error("CANARY_JUNTAS_FAILED", error instanceof Error && /^[A-Z_0-9]+$/.test(error.message)
    ? error.message : "CANARY_JUNTAS_FAILED");
  process.exitCode = 1;
}
