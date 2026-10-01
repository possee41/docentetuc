// Explicit production integration test. Creates only synthetic private rows, then removes them.
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { userDataDeletionStatements } from "../lib/data-deletion.ts";

if (!process.argv.includes("--remote-test")) {
  console.error("Este test escribe únicamente identidades sintéticas. Usá --remote-test de forma explícita.");
  process.exit(2);
}
const quoted = (value) => `'${String(value).replaceAll("'", "''")}'`;
const run = (sql) => {
  const result = spawnSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "docentetuc-db", "--config=wrangler.cloudflare.jsonc", "--remote", "--json", `--command=${sql}`], { encoding: "utf8", maxBuffer: 5_000_000 });
  if (result.status !== 0) throw new Error("D1 no ejecutó la consulta del test.");
  const response = JSON.parse(result.stdout);
  if (!Array.isArray(response) || response.some((entry) => !entry.success)) throw new Error("D1 no confirmó todas las sentencias del test.");
  return response[0]?.results ?? [];
};
const count = (sql) => Number(run(`SELECT COUNT(*) AS count FROM ${sql}`)[0]?.count ?? 0);
const first = run("SELECT id FROM publications LIMIT 1")[0]?.id;
if (!first) throw new Error("No hay publicación pública existente para enlazar el test.");
const idA = `device:${randomUUID()}`, idB = `device:${randomUUID()}`;
const refA = createHash("sha256").update(idA).digest("hex").slice(0, 20);
const publicBefore = count("publications"), profilesBefore = count("profiles");
const insert = (id, suffix) => {
  const q = quoted(id), p = quoted(first), eventId = quoted(`deletion-test:${suffix}:${id}`), endpoint = quoted(`https://example.invalid/push/${suffix}/${id}`);
  return [
    `INSERT INTO profiles (user_id,name) VALUES (${q},'Prueba de eliminación')`,
    `INSERT INTO saved_publications (user_id,publication_id,in_agenda) VALUES (${q},${p},1)`,
    `INSERT INTO notifications (user_id,publication_id,type) VALUES (${q},${p},'TEST_ELIMINACION')`,
    `INSERT INTO training_reminders (id,user_id,training_id,publication_id,opens_at,precision,remind_at) VALUES (${eventId},${q},'test',${p},'2099-01-01','date','2099-01-01')`,
    `INSERT INTO designation_tracking (id,user_id,publication_id) VALUES (${quoted(`tracking:${suffix}:${id}`)},${q},${p})`,
    `INSERT INTO manual_events (id,user_id,title,starts_at) VALUES (${eventId},${q},'Evento sintético','2099-01-01')`,
    `INSERT INTO manual_event_push_queue (user_id,event_id,title,occurrence_at) VALUES (${q},${eventId},'Evento sintético','2099-01-01')`,
    `INSERT INTO push_subscriptions (endpoint,user_id,device_id,p256dh,auth,active) VALUES (${endpoint},${q},${quoted(id.slice(7))},'test','test',0)`,
    `INSERT INTO push_preferences (user_id) VALUES (${q})`,
    `INSERT INTO push_deliveries (endpoint,notification_id,event_key) VALUES (${endpoint},0,${quoted(`test:${suffix}:${id}`)})`,
    `INSERT INTO ai_rate_limits (user_bucket,expires_at) VALUES (${quoted(`${id}:999`)},'2099-01-01')`,
    `INSERT INTO push_rate_limits (user_bucket,expires_at) VALUES (${quoted(`${id}:test`)},'2099-01-01')`,
  ].join(";") + ";";
};
const cleanup = (id) => {
  for (const statement of userDataDeletionStatements(id)) {
    let i = 0;
    run(statement.sql.replaceAll("?", () => quoted(statement.values[i++])));
  }
};
try {
  run(insert(idA, "a") + insert(idB, "b"));
  if (count(`profiles WHERE user_id=${quoted(idA)}`) !== 1 || count(`profiles WHERE user_id=${quoted(idB)}`) !== 1) throw new Error("No se crearon las dos identidades de prueba.");
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "scripts/delete-user-data.mjs", `--reference=${refA}`, "--remote", "--execute", "--verified", `--confirm=${refA}`], { encoding: "utf8", maxBuffer: 5_000_000 });
  if (result.status !== 0) throw new Error("Falló la herramienta administrativa de borrado.");
  for (const statement of userDataDeletionStatements(idA)) {
    let i = 0;
    const where = statement.sql.replace(/^DELETE FROM /, "SELECT COUNT(*) AS count FROM ").replaceAll("?", () => quoted(statement.values[i++]));
    if (Number(run(where)[0]?.count ?? 0) !== 0) throw new Error(`Quedaron datos de prueba en ${statement.table}.`);
  }
  if (count(`profiles WHERE user_id=${quoted(idB)}`) !== 1 || count("publications") !== publicBefore) throw new Error("Se alteró otra identidad o las publicaciones públicas.");
  console.log(JSON.stringify({ test: "APROBADA", deletedUserTables: userDataDeletionStatements(idA).length, otherIdentityUnaffected: true, publicRecordsUnaffected: true }));
} finally {
  cleanup(idA);
  cleanup(idB);
  if (count("profiles") !== profilesBefore || count("publications") !== publicBefore) throw new Error("La limpieza de las identidades sintéticas no se verificó.");
}
