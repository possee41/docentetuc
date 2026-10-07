import { CommunityError, listOpenCommunityReports, type CommunityDatabase } from "./community.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function isCommunityAdmin(database: CommunityDatabase, accountId: string) {
  if (!UUID.test(accountId)) return false;
  try {
    return Boolean(await database.prepare("SELECT 1 AS found FROM community_moderators WHERE user_id=? AND role='admin'")
      .bind(accountId).first());
  } catch { return false; }
}

export async function requireCommunityAdmin(database: CommunityDatabase, accountId: string | null) {
  if (!accountId) throw new CommunityError("AUTH_REQUIRED", 401);
  if (!await isCommunityAdmin(database, accountId)) throw new CommunityError("MODERATOR_REQUIRED", 403);
  return accountId;
}

export async function adminCommunityOverview(database: CommunityDatabase) {
  const reports = await listOpenCommunityReports(database);
  const hidden = await database.prepare(`
    SELECT 'post' AS target_type, p.id, p.body, p.moderated_at, p.moderation_reason, pp.display_name, pp.avatar_id
      FROM community_posts p JOIN public_profiles pp ON pp.user_id=p.author_user_id
      WHERE p.moderation_status='hidden'
    UNION ALL
    SELECT 'comment', c.id, c.body, c.moderated_at, c.moderation_reason, pp.display_name, pp.avatar_id
      FROM community_comments c JOIN public_profiles pp ON pp.user_id=c.author_user_id
      WHERE c.moderation_status='hidden'
    ORDER BY moderated_at DESC LIMIT 100
  `).bind().all<Record<string, unknown>>();
  const recent = await database.prepare(`
    SELECT action, reason, created_at FROM community_moderation_events
    UNION ALL SELECT action, '' AS reason, created_at FROM community_report_reviews
    ORDER BY created_at DESC LIMIT 30
  `).bind().all<Record<string, unknown>>();
  return {
    reports,
    hidden: (hidden.results || []).map((row) => ({
      targetType: row.target_type, targetId: row.id, text: row.body, moderatedAt: row.moderated_at, reason: row.moderation_reason,
      author: { displayName: row.display_name, avatarId: row.avatar_id },
    })),
    recent: (recent.results || []).map((row) => ({ action: row.action, reason: row.reason, createdAt: row.created_at })),
  };
}

export async function adminReportContext(database: CommunityDatabase, reportId: string) {
  if (!UUID.test(reportId)) throw new CommunityError("NOT_FOUND", 404);
  const report = await database.prepare("SELECT target_type, post_id, comment_id FROM community_reports WHERE id=?")
    .bind(reportId).first<{ target_type: string; post_id: string | null; comment_id: string | null }>();
  if (!report) throw new CommunityError("NOT_FOUND", 404);
  const postId = report.target_type === "post" ? report.post_id : (await database.prepare("SELECT post_id FROM community_comments WHERE id=?")
    .bind(report.comment_id).first<{ post_id: string }>())?.post_id;
  if (!postId) throw new CommunityError("NOT_FOUND", 404);
  const post = await database.prepare(`SELECT p.body AS text, p.created_at AS createdAt, p.moderation_status AS status,
    pp.display_name AS displayName, pp.avatar_id AS avatarId
    FROM community_posts p JOIN public_profiles pp ON pp.user_id=p.author_user_id WHERE p.id=?`)
    .bind(postId).first();
  const comments = await database.prepare(`SELECT c.body AS text, c.created_at AS createdAt, c.moderation_status AS status,
    pp.display_name AS displayName, pp.avatar_id AS avatarId
    FROM community_comments c JOIN public_profiles pp ON pp.user_id=c.author_user_id
    WHERE c.post_id=? ORDER BY c.created_at ASC LIMIT 100`).bind(postId).all();
  return { post, comments: comments.results || [] };
}

export async function reviewCommunityReport(database: CommunityDatabase, actorId: string, reportId: unknown, action: unknown) {
  if (!UUID.test(actorId) || !await isCommunityAdmin(database, actorId)) throw new CommunityError("MODERATOR_REQUIRED", 403);
  if (typeof reportId !== "string" || !UUID.test(reportId) || (action !== "resolve" && action !== "dismiss")) {
    throw new CommunityError("INVALID_TARGET", 400);
  }
  const report = await database.prepare("SELECT status FROM community_reports WHERE id=?").bind(reportId).first<{ status: string }>();
  if (!report) throw new CommunityError("NOT_FOUND", 404);
  if (report.status !== "open") throw new CommunityError("INVALID_TARGET", 409);
  const results = await database.batch([
    database.prepare(`INSERT INTO community_report_reviews(id, report_id, actor_user_id, action, created_at)
      SELECT ?, id, ?, ?, ? FROM community_reports WHERE id=? AND status='open'`)
      .bind(crypto.randomUUID(), actorId, action, new Date().toISOString(), reportId),
    database.prepare("UPDATE community_reports SET status=? WHERE id=? AND status='open'")
      .bind(action === "resolve" ? "reviewed" : "dismissed", reportId),
  ]);
  if (Number(results[0]?.meta?.changes ?? 0) !== 1) throw new CommunityError("INVALID_TARGET", 409);
  return { reviewed: true };
}
