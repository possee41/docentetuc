// Seed only the local Miniflare D1 used by `npm run dev`; never accepts a remote target.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { usefulInformation } from "../lib/useful-information.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const directory = join(root, ".wrangler", "state", "v3", "d1", "miniflare-D1DatabaseObject");
const files = readdirSync(directory).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
if (files.length !== 1) throw new Error("Iniciá `npm run dev` una vez antes de preparar su D1 local.");
const db = new DatabaseSync(join(directory, files[0]));
try {
  db.exec("PRAGMA foreign_keys=ON");
  const hasPublications = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publications'").get();
  if (!hasPublications) {
    const baseline = ["0000_docentetuc.sql", "0001_training_metadata.sql", "0002_reminders_ai.sql", "0003_web_push.sql"]
      .map((name) => join(root, "drizzle", name));
    const additions = readdirSync(join(root, "migrations")).filter((name) => /^\d{4}_.+\.sql$/.test(name))
      .sort().map((name) => join(root, "migrations", name));
    db.exec("BEGIN IMMEDIATE");
    try {
      for (const file of [...baseline, ...additions]) db.exec(readFileSync(file, "utf8"));
      db.exec("COMMIT");
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  const columns = new Set(db.prepare("PRAGMA table_info(publications)").all().map((row) => row.name));
  for (const name of ["metadata", "normalized_status", "source_status"]) {
    if (!columns.has(name)) throw new Error(`La D1 local tiene un esquema incompleto: falta ${name}.`);
  }
  const insert = db.prepare(`INSERT OR IGNORE INTO publications
    (id,source,external_id,kind,category,title,summary,status,official_url,content_hash,metadata,normalized_status,source_status)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,'UNKNOWN','sin verificar')`);
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const item of usefulInformation) insert.run(`info:${item.id}`, "Información oficial Tucumán", item.id,
      "informacion", item.category, item.title, item.summary, "consultar fuente", item.officialUrl,
      `local-reference:${item.id}`, JSON.stringify(item.metadata));
    for (const [id, kind, category, title] of [
      ["preview:vacante", "vacante", "Inscripciones SIME", "PRUEBA LOCAL — pedido de cobertura sin fechas verificadas"],
      ["preview:capacitacion", "capacitacion", "Capacitaciones", "PRUEBA LOCAL — capacitación sin inscripción confirmada"],
      ["preview:padron", "junta", "Padrones", "PRUEBA LOCAL — padrón de referencia"],
      ["preview:comunicado", "junta", "Comunicados", "PRUEBA LOCAL — comunicado de referencia"],
      ["preview:llamado", "junta", "Llamados abiertos", "PRUEBA LOCAL — documento sin vigencia confirmada"],
    ]) insert.run(id, "Vista previa local", id, kind, category, title,
      "Dato sintético de prueba; no representa una publicación oficial ni una oportunidad vigente.",
      "sin verificar", "", `local-synthetic:${id}`, JSON.stringify({ preview: true }));
    db.exec("COMMIT");
  } catch (error) { db.exec("ROLLBACK"); throw error; }
  console.log(JSON.stringify({ database: "D1 local de npm run dev", publicReferenceCards: usefulInformation.length,
    syntheticExamples: 5, publications: db.prepare("SELECT COUNT(*) AS count FROM publications").get().count }));
} finally { db.close(); }
