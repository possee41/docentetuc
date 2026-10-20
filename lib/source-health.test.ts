import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceHealth, sourceNotices } from "./source-health.ts";

const now = new Date("2026-10-19T12:00:00Z");
test("un OK antiguo no oculta un intento interrumpido y no afirma vigencia", () => {
  const row = { source: "Capacitación Docente", sync_status: "OK", last_successful_sync_at: "2026-10-11 12:00:00", last_attempt_at: "2026-10-18T09:00:00Z" };
  assert.equal(sourceHealth(row, now), "interrupted");
  assert.equal(sourceHealth({ ...row, last_attempt_at: row.last_successful_sync_at }, now), "stale");
  assert.equal(sourceHealth({ ...row, last_successful_sync_at: "2026-10-19T11:00:00Z", last_attempt_at: "2026-10-19T11:00:00Z" }, now), "current");
  assert.equal(sourceHealth({ ...row, sync_status: "TIMEOUT" }, now), "failed");
});

test("cada sección muestra solamente sus fuentes desactualizadas y conserva el enlace oficial", () => {
  const sync = [{ source: "SIME", sync_status: "OK", last_successful_sync_at: "2026-10-19T11:00:00Z" }];
  assert.deepEqual(sourceNotices("vacantes", "todas", sync, now), []);
  assert.deepEqual(sourceNotices("actos", "todas", sync, now).map((item) => item.source), ["Comunicados"]);
  assert.deepEqual(sourceNotices("capacitaciones", "platform:cenet", sync, now).map((item) => item.url), ["https://cenet.inet.edu.ar/mod/page/view.php?id=30493"]);
  assert.equal(sourceNotices("vacantes", "todas", [], now)[0]?.lastSuccess, null);
  assert.equal(sourceNotices("cuentas", "todas", sync, now).length, 0);
});

test("la advertencia utiliza el último intento real solo desde la API pública", () => {
  const publicRoute = readFileSync(new URL("../app/api/public-app/route.ts", import.meta.url), "utf8");
  const privateRoute = readFileSync(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  assert.match(publicRoute, /SELECT source, synced_at, last_attempt_at, last_successful_sync_at, sync_status FROM sync_state/u);
  assert.doesNotMatch(privateRoute, /FROM sync_state/u);
  const app = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
  assert.match(app, /data \|\| !loading \? sourceNotices\(view, trainingSource, data\?\.sync \|\| \[\]\)/u);
  assert.match(app, /Último éxito: \{verified\}/u);
  assert.match(app, /href=\{item\.url\}/u);
  assert.match(app, /unverified \? "Vigencia por verificar"/u);
  assert.match(app, /unverified \? "Verificar en fuente" : "INSCRIBIRME"/u);
  assert.match(app, /unverified \? `Cierre informado: \$\{dateLabel\(item\.ends_at, true\)\}` : fromNow\(item\.ends_at\)/u);
  assert.match(app, /unverified \? "Fechas publicadas · vigencia por verificar"/u);
  assert.match(app, /boardItems\(publications, view, now\)\.some\(\(item\) => sourceHealth\(healthForPublication\(item, sync\), now\) === "current"\)/u);
});
