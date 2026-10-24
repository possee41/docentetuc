// Populate only the Vite preview's local D1 with public CI-verified samples.
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const state = resolve(root, ".wrangler", "review-1.2");
const databaseDir = join(state, "v3", "d1", "miniflare-D1DatabaseObject");
const files = readdirSync(databaseDir).filter((name) => name.endsWith(".sqlite") && name !== "metadata.sqlite");
assert.equal(files.length, 1, "Start the isolated Vite preview once before seeding");
const db = new DatabaseSync(join(databaseDir, files[0]));
db.exec("PRAGMA foreign_keys=ON");

try {
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='publications'").get()) {
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

  const authFile = join(state, "auth.json");
  const auth = existsSync(authFile) ? JSON.parse(readFileSync(authFile, "utf8")) : {
    id: randomUUID(), token: randomBytes(32).toString("hex"), secret: randomBytes(32).toString("hex"),
  };
  if (!existsSync(authFile)) { mkdirSync(state, { recursive: true }); writeFileSync(authFile, JSON.stringify(auth), { mode: 0o600 }); }
  const now = new Date(), expires = new Date(now.getTime() + 24 * 60 * 60_000);
  db.prepare('INSERT OR IGNORE INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
    .run(auth.id, "Docente de prueba", "docente-local@example.invalid", 1, now.getTime(), now.getTime());
  db.prepare('INSERT OR REPLACE INTO "session" (id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)')
    .run("review-session", expires.getTime(), auth.token, now.getTime(), now.getTime(), auth.id);

  // These titles, links, dates and states came from the five-source CI run 40054724528.
  // Empty summaries and UNKNOWN dates are intentional: no editorial facts are invented.
  const samples = [
    { id: "fdci:commission:6380", source: "Capacitación Docente", kind: "capacitacion", category: "Capacitaciones", title: "Suelos Vivos: Lombrices y Prácticas Agroambientales en la Escuela Secundaria", url: "https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones/qjKkLqjg/suelos-vivos-lombrices-y-practicas-agroambientales-en-la-escuela-secundaria/6380", open: "2026-10-23T23:00:00-03:00", close: "2026-10-26T08:00:00-03:00", status: "vigente", normalized: "ACTIVE" },
    { id: "sime:143095", source: "SIME", kind: "vacante", category: "Inscripciones SIME", title: "ESC. Nº 382 LIBERTADOR DE AMERICA - MAESTRO DE GRADO - 115", url: "https://sime.educaciontuc.gov.ar/Vacantes/Detalle/143095?seleccionado=0&tab=1&accion=-1", open: "2026-10-23T08:00:00-03:00", close: "2026-10-27T08:00:00-03:00", status: "cerrada", normalized: "CLOSED" },
    { id: "review:juntas:notice", source: "Padrones y Comunicados", kind: "junta", category: "Comunicados", title: "Concurso de Antecedentes y Oposición para Ascenso de Jerarquía de Centro de Deportes y Recreación de Gestión Estatal", url: "https://docs.google.com/document/d/1Oo-LmX9DyPBfhZNHPRYYiRf6MJiN837VoSXK2F-LIZE/edit", open: null, close: null, status: "consultar", normalized: "UNKNOWN" },
    { id: "review:cenet:course", source: "CeNET / INET", kind: "capacitacion", category: "CeNET / INET", title: "Buenas Prácticas en el uso de la información", url: "https://cenet.inet.edu.ar/mod/page/view.php?id=30493", open: "2026-10-05T00:00:00-03:00", close: "2026-10-14T23:59:59-03:00", status: "consultar", normalized: "UNKNOWN" },
    { id: "review:infd:course", source: "INFoD / AulaS-TIC", kind: "capacitacion", category: "INFoD / AulaS-TIC", title: "La importancia de narraciones y cuentos para la alfabetización temprana", url: "https://red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/", open: null, close: null, status: "consultar", normalized: "UNKNOWN" },
  ];
  const insert = db.prepare(`INSERT OR IGNORE INTO publications
    (id,source,external_id,kind,category,title,summary,status,official_url,content_hash,metadata,
     registration_open_at,registration_close_at,normalized_status,source_status)
    VALUES (?,?,?,?,?,?,'',?,?,?,?,?,?,?,?)`);
  for (const item of samples) {
    const metadata = item.kind === "capacitacion" ? JSON.stringify({ registrationOpensAt: item.open,
      registrationClosesAt: item.close, dateStatus: item.normalized === "ACTIVE" ? "confirmed" : "unknown" }) : "{}";
    insert.run(item.id, item.source, item.id, item.kind, item.category, item.title, item.status,
      item.url, `review-ci-40054724528:${item.id}`, metadata, item.open, item.close, item.normalized, item.status.toUpperCase());
    db.prepare(`INSERT OR IGNORE INTO sync_state (source,synced_at,item_count,last_attempt_at,sync_status)
      VALUES (?,?,1,?,'PARTIAL')`).run(item.source, now.toISOString(), now.toISOString());
  }
  db.prepare(`INSERT OR IGNORE INTO news_items (id,status,editorial_title,editorial_summary,editorial_body,topic,relevance,published_at)
    VALUES ('review:news:sample','published','PRUEBA LOCAL — diseño editorial de Noticias',
      'Ejemplo sintético para revisar la pantalla. No es una noticia publicada por DocenteTuc.',
      'Esta ficha existe solo en la D1 aislada para comprobar la lectura completa y el enlace a una fuente.',
      'Prueba local','informativa',?)`).run(now.toISOString());
  db.prepare(`INSERT OR IGNORE INTO news_sources
    (id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary)
    VALUES ('review:news:source','review:news:sample','fdci:commission:6380',
      'Capacitación Docente','Fuente oficial FDCI',?,?, 'official',1)`)
    .run(samples[0].url, samples[0].url);

  const count = db.prepare("SELECT COUNT(*) AS n FROM publications").get().n;
  assert.equal(count, 5);
  console.log(JSON.stringify({ database: "D1 local aislada", officialSamples: count, news: "ejemplo sintético marcado",
    localAccount: "sesión de prueba, sin perfiles reales", lastSuccess: "no atribuido a muestras parciales" }));
} finally { db.close(); }
