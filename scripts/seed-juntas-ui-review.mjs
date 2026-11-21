// Synthetic Juntas records for the isolated UI preview. Never run against remote D1.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const state = resolve(".wrangler/juntas-ui-review/v3/d1/miniflare-D1DatabaseObject");
const files = readdirSync(state).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
if (files.length !== 1 || !state.includes("juntas-ui-review")) throw new Error("Expected exactly one isolated UI D1");
const db = new DatabaseSync(join(state, files[0]));
db.exec(readFileSync("scripts/fixtures/sime-ui-local.sql", "utf8").split("\n").slice(0, 2).join("\n"));

const juntas = ["Inicial y Primaria", "Secundaria", "Técnica", "Superior y Especial"];
const portal = "https://padrones.educaciontuc.gov.ar/";
const insert = db.prepare(`INSERT OR REPLACE INTO publications
  (id,source,external_id,kind,category,title,summary,level,junta,status,official_url,metadata,content_hash,source_published_at,normalized_status)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
db.exec("BEGIN");
try {
  for (let n = 1; n <= 54; n++) {
    const junta = juntas[(n - 1) % juntas.length];
    const id = String(n).padStart(3, "0");
    const summary = "MUESTRA SINTÉTICA LOCAL. El enlace abre el portal de Juntas, no un documento asociado a esta muestra.";
    for (const [key, category, title] of [
      ["padron", "Padrones", `PRUEBA LOCAL — Padrón definitivo 2026, listado ${id}`],
      ["comunicado", "Comunicados", `PRUEBA LOCAL — Comunicado de Junta ${id}`],
      ["llamado", "Llamados abiertos", `PRUEBA LOCAL — Referencia histórica de llamado ${id}`],
    ]) {
      const recordId = `review-juntas:${key}:${id}`;
      insert.run(recordId, "Padrones y Comunicados", recordId, "junta", category, title,
        summary, junta, junta, "referencia", portal, "{}", recordId, "2025-10-01", "UNKNOWN");
    }
  }
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}
console.log(JSON.stringify({ database: "juntas-ui-review", syntheticRows: 162,
  counts: db.prepare("SELECT category, count(*) AS count FROM publications WHERE id LIKE 'review-juntas:%' GROUP BY category").all() }));
db.close();
