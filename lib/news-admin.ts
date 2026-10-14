import { aiSourceType } from "./ai.ts";
import { requireCommunityAdmin } from "./community-admin.ts";
import { CommunityError, type CommunityDatabase } from "./community.ts";
import { isNewsRelevance, isNewsSourceType, isNewsStatus, isNewsWindow, normalizeNewsSourceUrl } from "./news-editorial.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type Row = Record<string, unknown>;
type NewsRow = Row & { id: string; status: string; updated_at: string; editorial_title: string; editorial_summary: string;
  relevance: string; valid_from: string | null; valid_until: string | null; origin_publication_id: string | null };
type Action = "create_candidate" | "edit" | "approve" | "publish" | "reject" | "archive" | "reopen" | "feature" | "unfeature" | "source_add" | "source_remove";

function fail(code = "INVALID_NEWS", status: CommunityError["status"] = 400): never { throw new CommunityError(code, status); }
function id(value: unknown): string { if (typeof value !== "string" || !UUID.test(value)) fail(); return value as string; }
function bounded(value: unknown, max: number, required = false): string {
  if (typeof value !== "string") fail();
  const text = (value as string).normalize("NFC").trim();
  if (text.length > max || (required && !text)) fail();
  return text;
}
function nextTimestamp(previous: string): string {
  return new Date(Math.max(Date.now(), (Date.parse(previous) || 0) + 1)).toISOString();
}
function isConflict(error: unknown) { return error instanceof Error && /UNIQUE|FOREIGN KEY|CHECK constraint/iu.test(error.message); }

export async function listNewsAdmin(database: CommunityDatabase, params: URLSearchParams) {
  const status = params.get("status") || "candidate";
  if (status !== "all" && !isNewsStatus(status)) fail();
  const q = (params.get("q") || "").trim().slice(0, 100);
  const page = Math.min(100, Math.max(0, Number.parseInt(params.get("page") || "0", 10) || 0));
  const [counts, rows] = await Promise.all([
    database.prepare("SELECT status, COUNT(*) AS count FROM news_items GROUP BY status").bind().all<{ status: string; count: number }>(),
    database.prepare(`SELECT n.id, n.status, n.editorial_title, n.editorial_summary, n.topic, n.relevance, n.featured,
      n.valid_from, n.valid_until, n.updated_at, p.title AS origin_title, p.removed_at AS origin_removed_at
      FROM news_items n LEFT JOIN publications p ON p.id=n.origin_publication_id
      WHERE (?='all' OR n.status=?) AND (?='' OR n.editorial_title LIKE ? OR n.editorial_summary LIKE ? OR p.title LIKE ?)
      ORDER BY n.updated_at DESC, n.id DESC LIMIT 30 OFFSET ?`)
      .bind(status, status, q, `%${q}%`, `%${q}%`, `%${q}%`, page * 30).all<Row>(),
  ]);
  return { counts: Object.fromEntries((counts.results || []).map((row) => [row.status, Number(row.count)])), items: rows.results || [], page };
}

export async function searchNewsOrigins(database: CommunityDatabase, query: string) {
  const q = query.trim().slice(0, 100);
  if (q.length < 2) return [];
  const rows = await database.prepare(`SELECT p.id, p.title, p.summary, p.source, p.official_url, p.removed_at,
    n.id AS existing_news_id FROM publications p LEFT JOIN news_items n ON n.origin_publication_id=p.id
    WHERE p.title LIKE ? OR p.summary LIKE ? OR p.source LIKE ? ORDER BY p.updated_at DESC LIMIT 25`)
    .bind(`%${q}%`, `%${q}%`, `%${q}%`).all<Row>();
  return rows.results || [];
}

export async function newsAdminDetail(database: CommunityDatabase, newsId: string) {
  const item = await database.prepare(`SELECT n.id,n.origin_publication_id,n.status,n.editorial_title,n.editorial_summary,
    n.topic,n.relevance,n.featured,n.valid_from,n.valid_until,n.approved_at,n.published_at,n.created_at,n.updated_at,
    p.title AS origin_title, p.official_url AS origin_url,
    p.removed_at AS origin_removed_at FROM news_items n LEFT JOIN publications p ON p.id=n.origin_publication_id WHERE n.id=?`)
    .bind(id(newsId)).first<NewsRow>();
  if (!item) fail("NOT_FOUND", 404);
  const [sources, events] = await Promise.all([
    database.prepare(`SELECT s.id, s.publication_id, s.source_name, s.source_title, s.url, s.source_type, s.is_primary, s.position,
      s.source_published_at, s.created_at, p.removed_at AS source_removed_at FROM news_sources s
      LEFT JOIN publications p ON p.id=s.publication_id WHERE s.news_item_id=? ORDER BY s.position, s.created_at`).bind(newsId).all<Row>(),
    database.prepare(`SELECT e.actor_kind, e.action, e.previous_status, e.next_status, e.details, e.created_at,
      COALESCE(u.name,'Administrador ya no disponible') AS actor_name FROM news_events e
      LEFT JOIN "user" u ON u.id=e.actor_user_id WHERE e.news_item_id=? ORDER BY e.created_at DESC LIMIT 100`).bind(newsId).all<Row>(),
  ]);
  const duplicateRows = await database.prepare(`SELECT s.id FROM news_sources s JOIN news_sources other
    ON other.news_item_id<>s.news_item_id AND (other.normalized_url=s.normalized_url
      OR (s.publication_id IS NOT NULL AND other.publication_id=s.publication_id)) WHERE s.news_item_id=? LIMIT 10`)
    .bind(newsId).all<{ id: string }>();
  return { item, sources: sources.results || [], events: events.results || [], sharedSourceIds: [...new Set((duplicateRows.results || []).map((row) => row.id))] };
}

async function loadCurrent(database: CommunityDatabase, input: Record<string, unknown>) {
  const newsId = id(input.id), expected = bounded(input.updatedAt, 100, true);
  const current = await database.prepare(`SELECT id,status,updated_at,editorial_title,editorial_summary,relevance,
    valid_from,valid_until,origin_publication_id FROM news_items WHERE id=?`).bind(newsId).first<NewsRow>();
  if (!current) fail("NOT_FOUND", 404);
  if (current.updated_at !== expected) fail("NEWS_STALE", 409);
  return current;
}

async function applyBatch(database: CommunityDatabase, statements: unknown[], eventIndex = 0) {
  try {
    const result = await database.batch(statements);
    if (Number(result[eventIndex]?.meta?.changes || 0) !== 1) fail("NEWS_STALE", 409);
  } catch (error) { if (isConflict(error)) fail("NEWS_CONFLICT", 409); throw error; }
}

function event(database: CommunityDatabase, eventId: string, item: NewsRow, actorId: string, action: Action,
  nextStatus: string | null, details: Record<string, unknown>, now: string, reviewedWithdrawn: boolean) {
  const originGuard = action === "publish" && !reviewedWithdrawn ? ` AND NOT EXISTS
    (SELECT 1 FROM publications p WHERE p.id=news_items.origin_publication_id AND p.removed_at IS NOT NULL)
    AND NOT EXISTS (SELECT 1 FROM news_sources s JOIN publications p ON p.id=s.publication_id
      WHERE s.news_item_id=news_items.id AND s.is_primary=1 AND p.removed_at IS NOT NULL)` : "";
  return database.prepare(`INSERT INTO news_events(id,news_item_id,actor_user_id,actor_kind,action,previous_status,next_status,details,created_at)
    SELECT ?,id,?,'admin',?,?,?,?,? FROM news_items WHERE id=? AND updated_at=?${originGuard}`)
    .bind(eventId, actorId, action, item.status, nextStatus, JSON.stringify(details), now, item.id, item.updated_at);
}

export async function mutateNewsAdmin(database: CommunityDatabase, actorId: string, input: Record<string, unknown>) {
  await requireCommunityAdmin(database, actorId);
  const action = input.action;
  if (action === "create_candidate") {
    const publicationId = bounded(input.publicationId, 240, true);
    const publication = await database.prepare(`SELECT id,title,summary,source,official_url,source_published_at,removed_at
      FROM publications WHERE id=?`).bind(publicationId).first<Row>();
    if (!publication) fail("NOT_FOUND", 404);
    const now = new Date().toISOString(), newsId = crypto.randomUUID(), eventId = crypto.randomUUID();
    const url = normalizeNewsSourceUrl(publication.official_url);
    const statements: unknown[] = [database.prepare(`INSERT INTO news_items
      (id,origin_publication_id,status,editorial_title,editorial_summary,created_by_user_id,created_at,updated_at)
      VALUES(?,?,'candidate',?,?,?, ?,?)`).bind(newsId, publicationId, String(publication.title).slice(0, 160),
        String(publication.summary || "").slice(0, 1200), actorId, now, now)];
    if (url) statements.push(database.prepare(`INSERT INTO news_sources
      (id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary,source_published_at)
      VALUES(?,?,?,?,?,?,?,?,1,?)`).bind(crypto.randomUUID(), newsId, publicationId, String(publication.source).slice(0, 120),
      String(publication.title).slice(0, 160), url, url, aiSourceType(String(publication.source)), publication.source_published_at || null));
    statements.push(database.prepare(`INSERT INTO news_events(id,news_item_id,actor_user_id,actor_kind,action,next_status,details,created_at)
      VALUES(?,?,?,'admin','create_candidate','candidate',?,?)`).bind(eventId, newsId, actorId, JSON.stringify({ publicationId }), now));
    await applyBatch(database, statements, 0);
    return { id: newsId, warning: publication.removed_at ? "La publicación de origen fue retirada; revisá su vigencia." : null };
  }

  if (!(["edit", "approve", "publish", "reject", "archive", "reopen", "feature", "unfeature", "source_add", "source_remove"] as unknown[]).includes(action)) fail();
  const kind = action as Action, item = await loadCurrent(database, input);
  const now = nextTimestamp(item.updated_at), eventId = crypto.randomUUID();
  let nextStatus: string | null = null, details: Record<string, unknown> = {};
  let mutation: unknown[] = [], warning: string | null = null;

  if (kind === "edit") {
    if (!["candidate", "approved", "published"].includes(item.status)) fail("NEWS_TRANSITION", 409);
    const title = bounded(input.title, 160), summary = bounded(input.summary, 1200), topic = bounded(input.topic ?? "", 80);
    if (!isNewsRelevance(input.relevance) || typeof input.validFrom !== "string" && input.validFrom !== null ||
      typeof input.validUntil !== "string" && input.validUntil !== null || !isNewsWindow(input.validFrom, input.validUntil)) fail();
    if (item.status === "published" && (!title || !summary || input.relevance === "urgente" && !input.validUntil)) fail();
    mutation = [database.prepare(`UPDATE news_items SET editorial_title=?,editorial_summary=?,topic=?,relevance=?,valid_from=?,valid_until=?,updated_at=?
      WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM news_events WHERE id=?)`)
      .bind(title, summary, topic || null, input.relevance, input.validFrom, input.validUntil, now, item.id, item.updated_at, eventId)];
    details = { fields: ["editorial_title", "editorial_summary", "topic", "relevance", "valid_from", "valid_until"] };
  } else if (kind === "source_add") {
    if (!["candidate", "approved", "published"].includes(item.status)) fail("NEWS_TRANSITION", 409);
    const url = normalizeNewsSourceUrl(input.url), sourceName = bounded(input.sourceName, 120, true);
    const sourceTitle = bounded(input.sourceTitle, 160, true), publicationId = input.publicationId == null ? null : bounded(input.publicationId, 240, true);
    if (!url || !isNewsSourceType(input.sourceType) || typeof input.isPrimary !== "boolean") fail();
    if (publicationId) {
      const linked = await database.prepare("SELECT official_url FROM publications WHERE id=?").bind(publicationId).first<{ official_url: string }>();
      if (!linked || normalizeNewsSourceUrl(linked.official_url) !== url) fail();
    }
    const sourceId = crypto.randomUUID();
    const previousPrimary = input.isPrimary ? await database.prepare("SELECT id FROM news_sources WHERE news_item_id=? AND is_primary=1")
      .bind(item.id).first<{ id: string }>() : null;
    const reused = await database.prepare(`SELECT 1 AS found FROM news_sources WHERE news_item_id<>?
      AND (normalized_url=? OR (? IS NOT NULL AND publication_id=?)) LIMIT 1`)
      .bind(item.id, url, publicationId, publicationId).first();
    if (reused) warning = "Otra noticia ya cita esta publicación o URL. Revisá si trata el mismo hecho.";
    if (input.isPrimary) mutation.push(database.prepare(`UPDATE news_sources SET is_primary=0 WHERE news_item_id=?
      AND EXISTS(SELECT 1 FROM news_events WHERE id=?)`).bind(item.id, eventId));
    mutation.push(database.prepare(`INSERT INTO news_sources(id,news_item_id,publication_id,source_name,source_title,url,normalized_url,source_type,is_primary,position,created_at)
      SELECT ?,id,?,?,?,?,?,?,?,?,? FROM news_items WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM news_events WHERE id=?)`)
      .bind(sourceId, publicationId, sourceName, sourceTitle, url, url, input.sourceType, Number(input.isPrimary), 0, now,
        item.id, item.updated_at, eventId));
    mutation.push(database.prepare("UPDATE news_items SET updated_at=? WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM news_sources WHERE id=?)")
      .bind(now, item.id, item.updated_at, sourceId));
    details = { sourceId, previousPrimaryId: previousPrimary?.id || null };
  } else if (kind === "source_remove") {
    if (!["candidate", "approved", "published"].includes(item.status)) fail("NEWS_TRANSITION", 409);
    const sourceId = id(input.sourceId);
    const source = await database.prepare("SELECT is_primary,url FROM news_sources WHERE id=? AND news_item_id=?")
      .bind(sourceId, item.id).first<{ is_primary: number; url: string }>();
    if (!source) fail("NOT_FOUND", 404);
    if (item.status === "published" && source.is_primary) fail("NEWS_PRIMARY_REQUIRED", 409);
    mutation = [database.prepare(`DELETE FROM news_sources WHERE id=? AND news_item_id=? AND EXISTS(SELECT 1 FROM news_events WHERE id=?)`)
      .bind(sourceId, item.id, eventId), database.prepare("UPDATE news_items SET updated_at=? WHERE id=? AND updated_at=? AND EXISTS(SELECT 1 FROM news_events WHERE id=?)")
      .bind(now, item.id, item.updated_at, eventId)];
    details = { sourceId, url: source.url.slice(0, 500) };
  } else {
    const transitions: Partial<Record<Action, [string[], string]>> = {
      approve: [["candidate"], "approved"], publish: [["approved"], "published"],
      reject: [["candidate", "approved"], "rejected"], archive: [["approved", "published"], "archived"],
      reopen: [["rejected", "archived"], "candidate"],
    };
    const transition = transitions[kind];
    if (transition && !transition[0].includes(item.status)) fail("NEWS_TRANSITION", 409);
    if ((kind === "feature" || kind === "unfeature") && item.status !== "published") fail("NEWS_TRANSITION", 409);
    nextStatus = transition?.[1] ?? item.status;
    if (kind === "approve" || kind === "publish") {
      if (!item.editorial_title.trim() || !item.editorial_summary.trim()) fail("NEWS_INCOMPLETE", 409);
    }
    if (kind === "publish") {
      if (!isNewsWindow(item.valid_from, item.valid_until) || item.relevance === "urgente" && !item.valid_until) fail("NEWS_INCOMPLETE", 409);
      if (item.valid_until && item.valid_until <= now) fail("NEWS_INCOMPLETE", 409);
      const main = await database.prepare(`SELECT s.url,p.removed_at FROM news_sources s
        LEFT JOIN publications p ON p.id=s.publication_id WHERE s.news_item_id=? AND s.is_primary=1`)
        .bind(item.id).first<{ url: string; removed_at: string | null }>();
      if (!main || !normalizeNewsSourceUrl(main.url)) fail("NEWS_PRIMARY_REQUIRED", 409);
      if (main.removed_at && input.confirmWithdrawnOrigin !== true) fail("NEWS_ORIGIN_WITHDRAWN", 409);
      if (main.removed_at) details = { withdrawnOriginReviewed: true };
      if (item.origin_publication_id) {
        const origin = await database.prepare("SELECT removed_at FROM publications WHERE id=?")
          .bind(item.origin_publication_id).first<{ removed_at: string | null }>();
        if ((!origin || origin.removed_at) && input.confirmWithdrawnOrigin !== true) fail("NEWS_ORIGIN_WITHDRAWN", 409);
        if (!origin || origin.removed_at) details = { withdrawnOriginReviewed: true };
      }
    }
    if (kind === "reject") details = { reason: bounded(input.reason ?? "", 300, true) };
    const assignment = kind === "feature" || kind === "unfeature" ? "featured=?" : "status=?";
    const assigned = kind === "feature" ? 1 : kind === "unfeature" ? 0 : nextStatus;
    const extra = kind === "approve" ? ",approved_at=?,approved_by_user_id=?" : kind === "publish" ? ",published_at=?"
      : kind === "reopen" ? ",approved_at=NULL,approved_by_user_id=NULL,published_at=NULL,featured=0" : "";
    const extraValues = kind === "approve" ? [now, actorId] : kind === "publish" ? [now] : [];
    mutation = [database.prepare(`UPDATE news_items SET ${assignment}${extra},updated_at=? WHERE id=? AND updated_at=?
      AND EXISTS(SELECT 1 FROM news_events WHERE id=?)`)
      .bind(assigned, ...extraValues, now, item.id, item.updated_at, eventId)];
  }

  const statements = [event(database, eventId, item, actorId, kind, nextStatus, details, now, input.confirmWithdrawnOrigin === true), ...mutation];
  await applyBatch(database, statements);
  return { id: item.id, updatedAt: now, warning };
}
