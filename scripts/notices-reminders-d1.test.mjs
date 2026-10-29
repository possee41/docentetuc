import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { Miniflare } = require("../node_modules/.pnpm/miniflare@4.20260515.0/node_modules/miniflare");
const { build } = require("../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild");
const migrations = [
  "drizzle/0000_docentetuc.sql", "drizzle/0001_training_metadata.sql",
  "drizzle/0002_reminders_ai.sql", "drizzle/0003_web_push.sql",
  "migrations/0002_designations.sql", "migrations/0003_information_agenda.sql",
  "migrations/0004_agenda_reminders.sql", "migrations/0006_manual_events.sql",
  "migrations/0007_manual_event_recurrence.sql", "migrations/0008_personal_matching_circuits.sql",
  "migrations/0009_reliability_lifecycle.sql", "migrations/0029_import_gateway_identity.sql",
];

test("ACK cuenta registros, no escrituras de índices, con D1 real efímera", async () => {
  const source = `
    import worker from "./workers/notices-receiver.mjs";
    export default { async fetch(request, env) {
      const trace = [];
      const db = { prepare(sql) {
        const wrap = stmt => ({ bind(...args) { return wrap(stmt.bind(...args)); },
          async all() { const r = await stmt.all(); return r; },
          async first() { return stmt.first(); },
          async run() { const r = await stmt.run(); trace.push({
            operation: sql.trim().split(/\\s+/).slice(0, 3).join(" "),
            changes: r.meta.changes, rowsWritten: r.meta.rows_written,
          }); return r; }
        });
        return wrap(env.DB.prepare(sql));
      } };
      const response = await worker.fetch(request, { ...env, DB: db });
      return Response.json({ http: response.status, ack: await response.json(), trace });
    } };`;
  const bundle = await build({ stdin: { contents: source, resolveDir: process.cwd(), loader: "ts" },
    bundle: true, write: false, format: "esm", platform: "browser", target: "es2022" });
  const databaseId = "11111111-1111-4111-8111-111111111111";
  const secret = "synthetic_local_notices_secret_1234567890";
  const mf = new Miniflare({ modules: true, script: bundle.outputFiles[0].text,
    d1Databases: ["DB"], bindings: { NOTICES_ENABLED: "true", NOTICES_IMPORT_SECRET: secret,
      NOTICES_DATABASE_NAME: "docentetuc-notices-canary-1-2", NOTICES_DATABASE_ID: databaseId },
    // This test must never call external services, including Cloudflare APIs.
    outboundService: () => { throw new Error("REMOTE_REQUEST_FORBIDDEN"); },
  });
  try {
    const db = await mf.getD1Database("DB");
    const seed = readFileSync(new URL("./notices-canary-seed.sql", import.meta.url), "utf8")
      .replaceAll("bee24175-2591-4fe3-a4ed-deb7f680f615", databaseId);
    for (const text of [...migrations.map(file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8")), seed]) {
      for (const sql of text.replace(/^--.*$/gm, "").split(";").map(part => part.trim()).filter(Boolean))
        await db.prepare(sql).run();
    }
    const invoke = async () => (await mf.dispatchFetch("http://local/api/internal/notices/reminders", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ mode: "reminders", limit: 10 }),
    })).json();
    const first = await invoke();
    const logical = first.trace.reduce((n, row) => n + row.changes, 0);
    const physical = first.trace.reduce((n, row) => n + row.rowsWritten, 0);
    console.log(JSON.stringify({ localD1: true, ack: first.ack, trace: first.trace, logical, physical }));
    assert.equal(first.http, 200);
    assert.deepEqual(first.trace.map(row => row.changes), Array(8).fill(1));
    assert.deepEqual(first.trace.map(row => row.rowsWritten), [5, 2, 5, 2, 5, 1, 4, 2]);
    assert.deepEqual(first.ack, { ok: true, considered: 4, inserted: 4, processed: 4 });
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 3);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 1);
    for (const [table, flag] of [["training_reminders", "notified"], ["designation_tracking", "reminder_notified"],
      ["saved_publications", "agenda_reminder_notified"], ["manual_events", "reminder_notified"]])
      assert.equal((await db.prepare(`SELECT ${flag} AS flag FROM ${table}`).first()).flag, 1);
    assert.deepEqual((await invoke()).ack, { ok: true, considered: 0, inserted: 0, processed: 0 });
    // Reproduce an interrupted row confirmation without removing its notice.
    await db.prepare("UPDATE training_reminders SET notified=0").run();
    const resumed = await invoke();
    assert.deepEqual(resumed.ack, { ok: true, considered: 1, inserted: 0, processed: 1 });
    assert.equal(resumed.trace[0].changes, 0);
    assert.ok(resumed.trace[0].rowsWritten > 0, "INSERT OR IGNORE puede escribir sin insertar un aviso");
    assert.equal((await db.prepare("SELECT count(*) AS n FROM notifications").first()).n, 3);
    assert.equal((await db.prepare("SELECT count(*) AS n FROM manual_event_push_queue").first()).n, 1);
  } finally { await mf.dispose(); }
});
