import { hasOfficialTopic } from "./official-publication.ts";
import type { CommunityDatabase } from "./community.ts";

type Row = Record<string, unknown>;
const SOURCES = ["SIME", "Comunicados", "Padrones", "Capacitación Docente", "INFoD / AulaS-TIC", "CeNET / INET"];

export async function adminDashboard(database: CommunityDatabase) {
  const [users, rows, sync] = await Promise.all([
    database.prepare('SELECT COUNT(*) AS count FROM "user"').bind().first<{ count: number }>(),
    database.prepare("SELECT kind, source, category, metadata FROM publications WHERE removed_at IS NULL").bind().all<Row>(),
    adminSyncStatus(database),
  ]);
  const counts = { users: Number(users?.count || 0), sime: 0, acts: 0, calls: 0, communiques: 0, padrones: 0, fdci: 0, infod: 0, cenet: 0 };
  for (const row of rows.results || []) {
    const item = { kind: String(row.kind || ""), source: String(row.source || ""), category: String(row.category || ""), metadata: String(row.metadata || "") };
    if (hasOfficialTopic(item, "INSCRIPCION_SIME")) counts.sime++;
    if (hasOfficialTopic(item, "ACTO_DESIGNACION")) counts.acts++;
    if (hasOfficialTopic(item, "LLAMADO_ABIERTO")) counts.calls++;
    if (hasOfficialTopic(item, "OTRO_COMUNICADO")) counts.communiques++;
    if (hasOfficialTopic(item, "PADRON")) counts.padrones++;
    if (item.kind === "capacitacion") {
      const source = item.source.toLowerCase();
      if (/fdci|capacitaci[oó]n docente/.test(source)) counts.fdci++;
      else if (/infod|aulas.tic/.test(source)) counts.infod++;
      else if (/cenet|inet/.test(source)) counts.cenet++;
    }
  }
  return { counts, sync };
}

export async function adminSyncStatus(database: CommunityDatabase) {
  const rows = await database.prepare(`SELECT source, synced_at AS syncedAt, last_attempt_at AS lastAttemptAt,
    last_successful_sync_at AS lastSuccessfulSyncAt, sync_status AS status, item_count AS itemCount,
    error_code AS errorCode FROM sync_state ORDER BY source`).bind().all<Row>();
  const bySource = new Map((rows.results || []).map((row) => [String(row.source), row]));
  return [...SOURCES.map((source) => bySource.get(source) || { source, status: "SIN DATOS", itemCount: 0 }),
    ...(rows.results || []).filter((row) => !SOURCES.includes(String(row.source)))].map((row) => ({
      source: String(row.source), lastAttemptAt: row.lastAttemptAt || null,
      lastSuccessfulSyncAt: row.lastSuccessfulSyncAt || null, status: String(row.status || "UNKNOWN"),
      itemCount: Number(row.itemCount || 0),
      // Raw error_message may contain URLs/headers; only controlled error codes reach Admin.
      errorCode: typeof row.errorCode === "string" && /^[A-Z0-9_]{2,60}$/.test(row.errorCode) ? row.errorCode : null,
    }));
}

export async function adminUsers(database: CommunityDatabase, search = "") {
  const term = search.trim().slice(0, 120);
  const result = await database.prepare(`SELECT u.name, u.email, u.createdAt AS createdAt,
    CASE WHEN EXISTS (SELECT 1 FROM "session" s WHERE s.userId=u.id AND s.expiresAt>?) THEN 'Con sesión vigente' ELSE 'Sin sesión vigente' END AS status,
    COALESCE(m.role, 'usuario') AS role
    FROM "user" u LEFT JOIN community_moderators m ON m.user_id=u.id
    WHERE (?='' OR u.email LIKE ? OR u.name LIKE ?)
    ORDER BY u.createdAt DESC LIMIT 100`)
    .bind(Date.now(), term, `%${term}%`, `%${term}%`).all<Row>();
  return (result.results || []).map((row) => ({
    name: row.name, email: row.email, createdAt: row.createdAt,
    // Better Auth does not persist a reliable last-access timestamp. Do not infer one from session refresh.
    lastAccess: null, status: row.status, role: row.role,
  }));
}

export async function adminPublications(database: CommunityDatabase, filters: URLSearchParams) {
  const read = (key: string) => (filters.get(key) || "").trim().slice(0, 100);
  const source = read("source"), status = read("status"), board = read("board"), level = read("level"), since = read("since"), kind = read("kind");
  const page = Math.min(1000, Math.max(0, Number.parseInt(read("page"), 10) || 0));
  const clauses = ["removed_at IS NULL"], values: unknown[] = [];
  for (const [column, value] of [["source", source], ["normalized_status", status], ["junta", board], ["level", level], ["kind", kind]]) {
    if (value) { clauses.push(["source", "junta", "level"].includes(column) ? `${column} LIKE ?` : `${column}=?`); values.push(["source", "junta", "level"].includes(column) ? `%${value}%` : value); }
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(since)) { clauses.push("COALESCE(source_published_at, updated_at)>=?"); values.push(since); }
  const result = await database.prepare(`SELECT title, kind, category, source, source_published_at AS publishedAt,
    official_url AS url, normalized_status AS status, updated_at AS updatedAt, metadata
    FROM publications WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC LIMIT 50 OFFSET ?`)
    .bind(...values, page * 50).all<Row>();
  return (result.results || []).map((row) => {
    const item = { kind: String(row.kind), category: String(row.category), source: String(row.source), metadata: String(row.metadata || "") };
    const type = item.kind === "capacitacion" ? "Capacitación"
      : item.kind === "informacion" ? "Información útil"
      : hasOfficialTopic(item, "ACTO_DESIGNACION") ? "Acto de designación"
      : hasOfficialTopic(item, "LLAMADO_ABIERTO") ? "Llamado abierto"
      : hasOfficialTopic(item, "PADRON") ? "Padrón"
      : hasOfficialTopic(item, "INSCRIPCION_SIME") ? "Inscripción SIME"
      : item.kind === "vacante" ? "Procedimiento pendiente" : "Comunicado";
    return { title: row.title, type, source: row.source, publishedAt: row.publishedAt || null,
      url: typeof row.url === "string" && row.url.startsWith("https://") ? row.url : null,
      status: row.status, updatedAt: row.updatedAt };
  });
}

export async function adminAIStatus(database: CommunityDatabase, settings: Record<string, string | undefined>) {
  const usage = await database.prepare("SELECT COALESCE(SUM(request_count),0) AS count FROM ai_rate_limits WHERE expires_at>?")
    .bind(new Date().toISOString()).first<{ count: number }>();
  return { provider: settings.AI_PROVIDER || "No configurado", model: settings.AI_MODEL || "No configurado",
    available: Boolean(settings.AI_PROVIDER && settings.AI_MODEL && settings.AI_API_KEY),
    recentRequests: Number(usage?.count || 0), requestWindow: "ventana activa de 15 minutos",
    recentErrors: "No se conserva un historial de errores de IA en D1.",
    webFallback: settings.AI_WEB_SEARCH_PROVIDER || "Desactivado" };
}
