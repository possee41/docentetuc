// Populate only the Vite preview's local D1 with public CI-verified samples.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
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
let previewAuth;

const editorialSamples = [
  { id: "9b30db2e-aea2-4317-bc0f-6881c0110001", title: "Alumnos y docentes se capacitaron en el uso educativo de drones",
    summary: "Estudiantes y docentes de escuelas técnicas y agrotécnicas participaron de una capacitación sobre el uso educativo de drones, organizada por la Dirección de Educación Técnica y Formación Profesional.",
    url: "https://www.educaciontuc.gov.ar/2026/10/23/alumnos-y-docentes-se-capacitaron-en-el-uso-educativo-de-drones/", date: "2026-10-23", topic: "Tecnología educativa", featured: true },
  { id: "9b30db2e-aea2-4317-bc0f-6881c0110002", title: "Educación formó a 300 docentes sobre RCP y primeros auxilios en la escuela",
    summary: "La Dirección de Educación Física impulsó una formación sobre RCP, uso de DEA y primeros auxilios destinada a 300 docentes de distintos niveles y modalidades.",
    url: "https://www.educaciontuc.gov.ar/2026/10/21/educacion-formo-a-300-docentes-en-rcp-y-primeros-auxilios-en-la-escuela/", date: "2026-10-21", topic: "Formación docente", featured: true },
  { id: "9b30db2e-aea2-4317-bc0f-6881c0110003", title: "Inició el congreso «La Transformación de la Escuela Secundaria en Tucumán»",
    summary: "El congreso comenzó el 20 de octubre y reunió a la comunidad educativa para compartir experiencias sobre la transformación de la escuela secundaria tucumana.",
    url: "https://www.educaciontuc.gov.ar/2026/10/20/inicio-el-congreso-la-transformacion-de-la-escuela-secundaria-en-tucuman/", date: "2026-10-20", topic: "Educación secundaria", featured: false },
];

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
  previewAuth = auth;
  const now = new Date(), expires = new Date(now.getTime() + 24 * 60 * 60_000);
  db.prepare('INSERT OR IGNORE INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,?,?,?)')
    .run(auth.id, "Docente de prueba", "docente-local@example.invalid", 1, now.getTime(), now.getTime());
  db.prepare('INSERT OR REPLACE INTO "session" (id,expiresAt,token,createdAt,updatedAt,userId) VALUES (?,?,?,?,?,?)')
    .run("review-session", expires.getTime(), auth.token, now.getTime(), now.getTime(), auth.id);
  db.prepare("INSERT OR IGNORE INTO community_moderators(user_id,role) VALUES (?,'admin')").run(auth.id);

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
  // Retain but expire the earlier synthetic design fixture; only verified articles remain public in this preview.
  db.prepare(`UPDATE news_items SET valid_until='2026-10-24T00:00:00.000Z'
    WHERE id='review:news:sample' AND editorial_title='PRUEBA LOCAL — diseño editorial de Noticias'`)
    .run();

  // Candidate fixtures only: the server's Admin workflow performs editing, approval and publication below.
  for (const article of editorialSamples) {
    db.prepare(`INSERT OR IGNORE INTO news_items(id,status,editorial_title,created_by_user_id,created_at,updated_at)
      VALUES (?,'candidate',?,?,?,?)`).run(article.id, article.title, auth.id, now.toISOString(), now.toISOString());
    db.prepare(`INSERT OR IGNORE INTO news_sources(id,news_item_id,source_name,source_title,url,normalized_url,
      source_type,is_primary,source_published_at) VALUES (?,?,?,?,?,?,'official',1,?)`)
      .run(`${article.id}:source`, article.id, "Ministerio de Educación de Tucumán", article.title,
        article.url, article.url, article.date);
    db.prepare(`INSERT OR IGNORE INTO news_events(id,news_item_id,actor_user_id,actor_kind,action,next_status,details)
      VALUES (?,?,?,'admin','create_candidate','candidate','{"localPreview":true}')`)
      .run(`${article.id}:candidate`, article.id, auth.id);
  }

  const count = db.prepare("SELECT COUNT(*) AS n FROM publications").get().n;
  assert.equal(count, 5);
  console.log(JSON.stringify({ database: "D1 local aislada", officialSamples: count,
    editorialCandidates: editorialSamples.length, localAccount: "sesión de prueba, sin perfiles reales",
    lastSuccess: "no atribuido a muestras parciales" }));
} finally { db.close(); }

// Exercise the same Admin validations and audit transitions used in the UI; never touch a remote D1.
const signed = `${previewAuth.token}.${createHmac("sha256", previewAuth.secret).update(previewAuth.token).digest("base64")}`;
const headers = { Cookie: `docentetuc-auth.session_token=${signed}`, Origin: "http://localhost:8793", "Content-Type": "application/json" };
async function admin(body) {
  const response = await fetch("http://localhost:8793/api/admin/news", { method: "POST", headers, body: JSON.stringify(body) });
  const result = await response.json();
  assert.ok(response.ok, `Local editorial action ${body.action} failed: ${JSON.stringify(result)}`);
  return result;
}
for (const article of editorialSamples) {
  const response = await fetch(`http://localhost:8793/api/admin/news?id=${article.id}`, { headers });
  assert.equal(response.status, 200, "Local Admin access is required for editorial review");
  let { item } = await response.json();
  if (item.status === "published" && item.hero_image_url) {
    await admin({ action: "archive", id: article.id, updatedAt: item.updated_at });
    ({ item } = await (await fetch(`http://localhost:8793/api/admin/news?id=${article.id}`, { headers })).json());
    await admin({ action: "reopen", id: article.id, updatedAt: item.updated_at });
    ({ item } = await (await fetch(`http://localhost:8793/api/admin/news?id=${article.id}`, { headers })).json());
  }
  if (item.status === "candidate" || item.status === "approved") {
    await admin({ action: "edit", id: article.id, updatedAt: item.updated_at, title: article.title,
      summary: article.summary, body: "", topic: article.topic, relevance: "importante",
      validFrom: null, validUntil: null, imageUrl: "", imageAlt: "", imageCredit: "",
      imageSourceUrl: "", imageRightsNote: "", imageRightsUrl: "" });
    ({ item } = await (await fetch(`http://localhost:8793/api/admin/news?id=${article.id}`, { headers })).json());
  }
  if (item.status === "candidate") {
    await admin({ action: "approve", id: article.id, updatedAt: item.updated_at, confirmImageRights: true });
    ({ item } = await (await fetch(`http://localhost:8793/api/admin/news?id=${article.id}`, { headers })).json());
  }
  if (item.status === "approved") {
    await admin({ action: "publish", id: article.id, updatedAt: item.updated_at });
    ({ item } = await (await fetch(`http://localhost:8793/api/admin/news?id=${article.id}`, { headers })).json());
  }
  if (article.featured && !item.featured) await admin({ action: "feature", id: article.id, updatedAt: item.updated_at });
}
console.log(JSON.stringify({ locallyReviewedAndPublished: editorialSamples.length,
  images: "category illustrations selected at read time, not stored per article" }));
