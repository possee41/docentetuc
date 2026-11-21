// Read the live official catalogue and import at most two records into an
// in-memory D1 fixture. No remote gateway, Cloudflare token or production write.
import gateway from "../workers/source-import-gateway.mjs";
import { fdciLocalFixture } from "./fdci-local-fixture.mjs";
import { runFdciDaily } from "./fdci-daily.mjs";

const secret = "synthetic_official_local_probe_1234567890";
const name = "docentetuc-web-canary-1-2-local";
const id = "00000000-0000-4000-8000-000000000012";
const config = { IMPORT_GATEWAY_ENABLED: "true", IMPORT_GATEWAY_TARGET: "canary",
  IMPORT_GATEWAY_ORIGIN: "http://127.0.0.1:8798", IMPORT_GATEWAY_DATABASE_NAME: name,
  IMPORT_GATEWAY_DATABASE_ID: id, FDCI_IMPORT_SECRET: secret, IMPORT_GATE_RUN_ID: "official-local",
  SYNC_SOURCE: "fdci", FDCI_SCOPE: "active", FDCI_MAX_REQUESTS: "6",
  FDCI_MAX_PUBLICATIONS: "2", FDCI_MAX_SLICES: "1", FDCI_PAUSE_MS: "3500" };
const { sqlite, db } = fdciLocalFixture();
try {
  sqlite.prepare("INSERT INTO import_gateway_identity VALUES(1,?,?)").run(name, id);
  const env = { DB: db, IMPORT_DATABASE_NAME: name, IMPORT_DATABASE_ID: id,
    FDCI_IMPORT_SECRET: secret, IMPORT_GATE_ENABLED: "false", IMPORT_GATE_LEASE_REQUIRED: "true",
    IMPORT_GATE_ALLOWED_SOURCE: "fdci", FDCI_EXTERNAL_ENABLED: "true" };
  const receiver = (url, init) => gateway.fetch(new Request(url, init), env);
  const result = await runFdciDaily(config, "", fetch, receiver);
  const rows = sqlite.prepare(`SELECT id,title,normalized_status,registration_open_at,registration_close_at,
    last_seen_at,metadata FROM publications ORDER BY id`).all().map(row => {
    const metadata = JSON.parse(row.metadata);
    return { id: row.id, title: row.title, status: row.normalized_status,
      opening: row.registration_open_at, closing: row.registration_close_at,
      dateStatus: metadata.dateStatus, hasObservation: Boolean(row.last_seen_at) };
  });
  const checkpoint = sqlite.prepare("SELECT cycle,revision,upper_key,last_cycle_status FROM fdci_import_checkpoint WHERE id=1").get();
  console.log(JSON.stringify({ status: result.status, code: result.code || null, cycleComplete: result.cycleComplete,
    discovered: result.discovered, created: result.created, unchanged: result.unchanged,
    sourceRequests: result.sourceRequests, closed: result.closed,
    checkpoint: { cycle: checkpoint.cycle, revision: checkpoint.revision,
      pending: Boolean(checkpoint.upper_key), status: checkpoint.last_cycle_status }, rows }));
  if (result.status !== "OK" || result.cycleComplete !== true || rows.length !== result.created) process.exitCode = 1;
} finally { sqlite.close(); }
