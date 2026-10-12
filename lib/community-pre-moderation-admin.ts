import { requireCommunityAdmin } from "./community-admin.ts";
import { CommunityError, type CommunityDatabase } from "./community.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type ModerationQueueFilters = { page?: number; type?: "all" | "post" | "comment"; priority?: "all" | "high"; order?: "oldest" | "newest" };
const PAGE_SIZE = 20;
const HIGH_PRIORITY = "EXISTS (SELECT 1 FROM json_each(m.categories) WHERE value <> 'uncertain')";

export async function listPreModerationQueue(database: CommunityDatabase, filters: ModerationQueueFilters = {}) {
  const type = filters.type === "post" || filters.type === "comment" ? filters.type : "all";
  const priority = filters.priority === "high" ? "high" : "all";
  const order = filters.order === "newest" ? "DESC" : "ASC";
  const where = `m.decision='pending_review'${type === "all" ? "" : " AND m.target_type=?"}${priority === "high" ? ` AND ${HIGH_PRIORITY}` : ""}`;
  const values = type === "all" ? [] : [type];
  const from = `FROM community_pre_moderation m
    LEFT JOIN community_posts p ON p.id=m.post_id
    LEFT JOIN community_comments c ON c.id=m.comment_id
    LEFT JOIN community_posts parent ON parent.id=c.post_id
    JOIN public_profiles pp ON pp.user_id=COALESCE(p.author_user_id,c.author_user_id)`;
  const count = await database.prepare(`SELECT COUNT(*) AS total ${from} WHERE ${where}`)
    .bind(...values).first<{ total: number }>();
  const total = Number(count?.total || 0);
  const allCount = type === "all" && priority === "all" ? count : await database.prepare(`SELECT COUNT(*) AS total ${from} WHERE m.decision='pending_review'`)
    .bind().first<{ total: number }>();
  const pendingTotal = Number(allCount?.total || 0);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const requestedPage = typeof filters.page === "number" && Number.isSafeInteger(filters.page) && filters.page > 0 ? filters.page : 1;
  const page = Math.min(requestedPage, totalPages);
  const rows = await database.prepare(`
    SELECT m.target_type, COALESCE(m.post_id,m.comment_id) AS target_id, m.decision,
      m.categories, m.confidence, m.reason, m.created_at, m.decision_source,
      COALESCE(p.body,c.body) AS text, pp.display_name, pp.avatar_id,
      c.post_id AS context_post_id, parent.body AS context_post_text
    ${from} WHERE ${where}
    ORDER BY m.created_at ${order}, target_id ${order} LIMIT ? OFFSET ?
  `).bind(...values, PAGE_SIZE, (page - 1) * PAGE_SIZE).all<Record<string, unknown>>();
  const items = (rows.results || []).map((row) => ({
    targetType: row.target_type, targetId: row.target_id, decision: row.decision,
    categories: JSON.parse(String(row.categories || "[]")) as string[], confidence: Number(row.confidence),
    reason: row.reason, createdAt: row.created_at, decisionSource: row.decision_source,
    text: row.text, author: { displayName: row.display_name, avatarId: row.avatar_id },
    context: row.context_post_id ? { postText: row.context_post_text } : null,
  }));
  return { items, total, pendingTotal, page, pageSize: PAGE_SIZE, totalPages };
}

export async function listPreModerationHistory(database: CommunityDatabase) {
  const rows = await database.prepare(`
    SELECT e.target_type, e.action, e.reason, e.created_at,
      CASE WHEN e.actor_user_id IS NULL THEN 'Automática' ELSE 'Administrador' END AS reviewer
    FROM community_pre_moderation_events e ORDER BY e.created_at DESC LIMIT 50
  `).bind().all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({ targetType: row.target_type, action: row.action,
    reason: row.reason, createdAt: row.created_at, reviewer: row.reviewer }));
}

export async function reviewPreModeration(database: CommunityDatabase, actorId: string, input: Record<string, unknown>) {
  await requireCommunityAdmin(database, actorId);
  const type = input.targetType, id = input.targetId, action = input.action;
  if ((type !== "post" && type !== "comment") || typeof id !== "string" || !UUID.test(id) ||
    (action !== "approve" && action !== "reject")) throw new CommunityError("INVALID_TARGET", 400);
  const column = type === "post" ? "post_id" : "comment_id", table = type === "post" ? "community_posts" : "community_comments";
  const current = await database.prepare(`SELECT decision FROM community_pre_moderation WHERE ${column}=?`)
    .bind(id).first<{ decision: string }>();
  if (!current || current.decision !== "pending_review") throw new CommunityError("INVALID_TARGET", 409);
  const decision = action === "approve" ? "approved" : "rejected", now = new Date().toISOString();
  const result = await database.batch([
    database.prepare(`INSERT INTO community_pre_moderation_events
      (id,target_type,post_id,comment_id,actor_user_id,action,reason,created_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ? FROM community_pre_moderation
      WHERE ${column}=? AND decision='pending_review'`)
      .bind(crypto.randomUUID(), type, type === "post" ? id : null, type === "comment" ? id : null,
        actorId, action === "approve" ? "manual_approved" : "manual_rejected", "Revisión administrativa", now, id),
    database.prepare(`UPDATE community_pre_moderation SET decision=?, decision_source='manual', reviewed_by=?, reviewed_at=?
      WHERE ${column}=? AND decision='pending_review'`).bind(decision, actorId, now, id),
    database.prepare(`UPDATE ${table} SET moderation_status=?, moderated_at=?, moderation_reason=? WHERE id=?
      AND EXISTS(SELECT 1 FROM community_pre_moderation WHERE ${column}=? AND decision=? AND reviewed_by=? AND reviewed_at=?)`)
      .bind(action === "approve" ? "visible" : "hidden", action === "approve" ? null : now,
        action === "approve" ? null : "other", id, id, decision, actorId, now),
  ]);
  if (Number(result[0]?.meta?.changes ?? 0) !== 1 || Number(result[1]?.meta?.changes ?? 0) !== 1 || Number(result[2]?.meta?.changes ?? 0) !== 1) {
    throw new CommunityError("INVALID_TARGET", 409);
  }
  return { reviewed: true, decision };
}

export async function restrictCommunityAuthor(database: CommunityDatabase, actorId: string, input: Record<string, unknown>) {
  await requireCommunityAdmin(database, actorId);
  const type = input.targetType, id = input.targetId;
  if ((type !== "post" && type !== "comment") || typeof id !== "string" || !UUID.test(id)) throw new CommunityError("INVALID_TARGET", 400);
  const table = type === "post" ? "community_posts" : "community_comments";
  const target = await database.prepare(`SELECT author_user_id FROM ${table} WHERE id=?`).bind(id).first<{ author_user_id: string }>();
  if (!target || target.author_user_id === actorId) throw new CommunityError("INVALID_TARGET", 400);
  if (await database.prepare("SELECT 1 AS found FROM community_user_restrictions WHERE user_id=?")
    .bind(target.author_user_id).first()) throw new CommunityError("INVALID_TARGET", 409);
  const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO community_user_restrictions(user_id,reason,actor_user_id,created_at)
      VALUES(?,'other',?,?) ON CONFLICT(user_id) DO NOTHING`).bind(target.author_user_id, actorId, now),
    database.prepare(`INSERT INTO community_user_restriction_events(id,user_id,actor_user_id,action,reason,created_at)
      VALUES(?,?,?,'block','other',?)`).bind(crypto.randomUUID(), target.author_user_id, actorId, now),
  ]);
  return { restricted: true };
}
