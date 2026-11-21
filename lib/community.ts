import { PUBLIC_AVATAR_IDS, validatePublicProfile, type PublicAvatarId, type PublicProfile } from "./public-profile.ts";
import { localDraftClassifier, normalizePreModerationResult, type CommunityDraftClassifier, type DraftType, type PreModerationResult } from "./community-pre-moderation.ts";

export const COMMUNITY_RULES_VERSION = "1";
export const COMMUNITY_RULES_TEXT = `Comunidad DocenteTuc\n\nEspacio destinado a consultas, experiencias, problemas, recursos y ayuda relacionados con la docencia.\n\nNo se permite:\n• contenido ajeno a la temática docente;\n• insultar, agredir, hostigar o amenazar;\n• denigrar o humillar;\n• discriminación;\n• publicar datos personales o sensibles de terceros;\n• spam o publicidad engañosa;\n• actividades ilegales.\n\nLos contenidos que incumplan estas normas podrán ser reportados y moderados.`;

export const COMMUNITY_REPORT_REASONS = [
  "off_topic", "harassment", "discrimination", "personal_data", "spam", "illegal", "other",
] as const;
export type CommunityReportReason = typeof COMMUNITY_REPORT_REASONS[number];
export type CommunityTargetType = "post" | "comment";
export type CommunityModerationAction = "hide" | "restore" | "remove";
export type CommunityFeedSort = "recent" | "popular";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RATE_LIMITS = { post: 5, comment: 30, report: 10 } as const;
const RATE_WINDOW_MS = 60 * 60 * 1000;
const MODERATED_CONTENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_POST_LENGTH = 2000;
const MAX_COMMENT_LENGTH = 1000;

export type CommunityDatabase = {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      first<T>(): Promise<T | null>;
      all<T>(): Promise<{ results?: T[] }>;
      run(): Promise<{ meta?: { changes?: number; rows_read?: number; rows_written?: number } }>;
    };
  };
  batch(statements: unknown[]): Promise<Array<{ meta?: { changes?: number; rows_read?: number; rows_written?: number } }>>;
};

export class CommunityError extends Error {
  readonly code: string;
  readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 428 | 429 | 503;

  constructor(code: string, status: CommunityError["status"]) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

function throwCommunity(code: string, status: CommunityError["status"]): never {
  throw new CommunityError(code, status);
}

export function communityErrorResponse(error: unknown) {
  const knownStatuses = [400, 401, 403, 404, 409, 413, 428, 429, 503] as const;
  const detail = error instanceof CommunityError ? error : error && typeof error === "object"
    ? error as { code?: unknown; status?: unknown }
    : null;
  if (detail && typeof detail.code === "string" && knownStatuses.includes(detail.status as typeof knownStatuses[number])) {
    const status = Number(detail.status);
    const messages: Record<string, string> = {
      AUTH_REQUIRED: "Iniciá sesión con Google para continuar.",
      PROFILE_REQUIRED: "Configurá un nombre público y elegí un avatar antes de participar.",
      RULES_REQUIRED: "Leé y aceptá la versión vigente de las Normas de Comunidad.",
      INVALID_TEXT: "Escribí un texto válido.",
      TEXT_TOO_LONG: "El texto supera el máximo permitido.",
      NOT_FOUND: "El contenido ya no está disponible.",
      NOT_OWNER: "Solo podés modificar o eliminar tu propio contenido.",
      DUPLICATE_REPORT: "Ya reportaste este contenido.",
      INVALID_REASON: "Elegí un motivo de reporte válido.",
      INVALID_TARGET: "El contenido indicado no es válido para esta acción.",
      INVALID_CURSOR: "No se pudo continuar con esta página. Actualizá el feed e intentá de nuevo.",
      INVALID_SORT: "Elegí un orden válido para las publicaciones.",
      SELF_BLOCK: "No podés bloquear tu propia cuenta.",
      DUPLICATE_BLOCK: "Esta cuenta ya está bloqueada.",
      BLOCK_NOT_FOUND: "El bloqueo ya no está disponible.",
      MODERATOR_REQUIRED: "Esta acción requiere permisos de moderación.",
      RATE_LIMITED: "Alcanzaste el límite temporal. Probá de nuevo más tarde.",
      RULES_ACCEPTANCE_REQUIRED: "Confirmá que aceptás las Normas de Comunidad.",
      SCHEMA_UNAVAILABLE: "Comunidad todavía no está habilitada en esta base local.",
      REQUEST_TOO_LARGE: "El pedido supera el tamaño permitido.",
      PARTICIPATION_RESTRICTED: "Tu participación en Comunidad está restringida. Contactá a soporte si necesitás revisar esta decisión.",
      INVALID_NEWS: "Revisá los datos editoriales e intentá nuevamente.",
      NEWS_STALE: "Otra persona modificó esta noticia. Recargala antes de continuar.",
      NEWS_CONFLICT: "Esta noticia o fuente ya existe, o sus datos entran en conflicto. Recargá e intentá nuevamente.",
      NEWS_TRANSITION: "Esta acción no corresponde al estado actual de la noticia.",
      NEWS_INCOMPLETE: "Completá título, resumen y vigencia antes de publicar.",
      NEWS_PRIMARY_REQUIRED: "Se necesita una fuente principal HTTPS verificable.",
      NEWS_ORIGIN_WITHDRAWN: "La publicación de origen fue retirada. Revisá la evidencia y confirmá expresamente antes de publicar.",
    };
    return Response.json({ error: messages[detail.code] || "No se pudo completar la solicitud." }, {
      status,
      headers: { "Cache-Control": "no-store, private" },
    });
  }
  return Response.json({ error: "No se pudo completar la solicitud." }, {
    status: 500,
    headers: { "Cache-Control": "no-store" },
  });
}

function validId(id: unknown): id is string {
  return typeof id === "string" && UUID.test(id);
}

function normalizedText(value: unknown, maxLength: number) {
  if (typeof value !== "string") throwCommunity("INVALID_TEXT", 400);
  const text = value.normalize("NFC").replace(/\r\n?/gu, "\n").trim();
  if (!text) throwCommunity("INVALID_TEXT", 400);
  if ([...text].length > maxLength) throwCommunity("TEXT_TOO_LONG", 413);
  return text;
}

async function publicProfile(database: CommunityDatabase, accountId: string): Promise<PublicProfile> {
  const row = await database.prepare("SELECT display_name, avatar_id, bio FROM public_profiles WHERE user_id=?")
    .bind(accountId).first<Record<string, unknown>>();
  const validated = row && validatePublicProfile({ displayName: row.display_name, avatarId: row.avatar_id, bio: row.bio });
  if (!validated || !validated.ok || !validated.value.displayName || !PUBLIC_AVATAR_IDS.includes(validated.value.avatarId as PublicAvatarId)) {
    throwCommunity("PROFILE_REQUIRED", 409);
  }
  return validated.value;
}

async function assertReady(database: CommunityDatabase, accountId: string) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  const profile = await publicProfile(database, accountId);
  const acceptance = await database.prepare("SELECT rules_version FROM community_rules_acceptances WHERE user_id=?")
    .bind(accountId).first<{ rules_version: string }>();
  if (acceptance?.rules_version !== COMMUNITY_RULES_VERSION) throwCommunity("RULES_REQUIRED", 428);
  if (await database.prepare("SELECT 1 AS found FROM community_user_restrictions WHERE user_id=?")
    .bind(accountId).first()) throwCommunity("PARTICIPATION_RESTRICTED", 403);
  return profile;
}

async function decideDraft(database: CommunityDatabase, accountId: string, type: DraftType, text: string,
  now: number, classifier: CommunityDraftClassifier): Promise<PreModerationResult> {
  const table = type === "post" ? "community_posts" : "community_comments";
  const duplicate = await database.prepare(`SELECT 1 AS found FROM ${table}
    WHERE author_user_id=? AND body=? AND created_at>=? LIMIT 1`)
    .bind(accountId, text, new Date(now - 60 * 60_000).toISOString()).first();
  if (duplicate) return { decision: "pending_review", categories: ["spam"], confidence: 0.9,
    reason: "Contenido idéntico reciente", reviewRequired: true };
  try { return normalizePreModerationResult(await classifier(text, type)); }
  catch { return { decision: "pending_review", categories: ["uncertain"], confidence: 0,
    reason: "Evaluación automática no disponible", reviewRequired: true }; }
}

function preModerationInsert(database: CommunityDatabase, type: DraftType, id: string, result: PreModerationResult, now: number) {
  return database.prepare(`INSERT INTO community_pre_moderation
    (target_type, post_id, comment_id, decision, categories, confidence, reason, decision_source, created_at)
    VALUES(?, ?, ?, ?, ?, ?, ?, 'automatic', ?)`).bind(type, type === "post" ? id : null,
      type === "comment" ? id : null, result.decision, JSON.stringify(result.categories), result.confidence,
      result.reason, new Date(now).toISOString());
}

function preModerationEvent(database: CommunityDatabase, type: DraftType, id: string, result: PreModerationResult, now: number) {
  return database.prepare(`INSERT INTO community_pre_moderation_events
    (id, target_type, post_id, comment_id, action, reason, created_at) VALUES(?, ?, ?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), type, type === "post" ? id : null, type === "comment" ? id : null,
      result.decision, result.reason, new Date(now).toISOString());
}

async function consumeRateLimit(database: CommunityDatabase, accountId: string, action: keyof typeof RATE_LIMITS, now: number) {
  const windowKey = Math.floor(now / RATE_WINDOW_MS);
  const result = await database.prepare(`
    INSERT INTO community_rate_limits (user_id, action, window_key, request_count)
    VALUES (?, ?, ?, 1)
    ON CONFLICT(user_id, action, window_key) DO UPDATE SET request_count=request_count+1
      WHERE request_count < ?
  `).bind(accountId, action, windowKey, RATE_LIMITS[action]).run();
  if (Number(result.meta?.changes ?? 0) === 0) throwCommunity("RATE_LIMITED", 429);
  await database.prepare("DELETE FROM community_rate_limits WHERE user_id=? AND action=? AND window_key < ?")
    .bind(accountId, action, windowKey - 2).run();
}

export async function acceptCommunityRules(database: CommunityDatabase, accountId: string, accepted: unknown, now = Date.now()) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (accepted !== true) throwCommunity("RULES_ACCEPTANCE_REQUIRED", 400);
  await database.prepare(`
    INSERT INTO community_rules_acceptances(user_id, rules_version, accepted_at)
    VALUES(?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET
      rules_version=excluded.rules_version,
      accepted_at=CASE WHEN community_rules_acceptances.rules_version <> excluded.rules_version THEN excluded.accepted_at ELSE community_rules_acceptances.accepted_at END
  `).bind(accountId, COMMUNITY_RULES_VERSION, new Date(now).toISOString()).run();
  return { rulesVersion: COMMUNITY_RULES_VERSION, accepted: true };
}

export async function communityStatus(database: CommunityDatabase, accountId: string | null) {
  let profileConfigured = false;
  let publicProfile: PublicProfile | null = null;
  let acceptedRulesVersion: string | null = null;
  if (accountId && validId(accountId)) {
    const row = await database.prepare("SELECT display_name, avatar_id, bio FROM public_profiles WHERE user_id=?")
      .bind(accountId).first<Record<string, unknown>>();
    const validation = row && validatePublicProfile({ displayName: row.display_name, avatarId: row.avatar_id, bio: row.bio });
    profileConfigured = Boolean(validation?.ok && validation.value.displayName);
    if (validation?.ok && profileConfigured) publicProfile = validation.value;
    const acceptance = await database.prepare("SELECT rules_version FROM community_rules_acceptances WHERE user_id=?")
      .bind(accountId).first<{ rules_version: string }>();
    acceptedRulesVersion = acceptance?.rules_version ?? null;
  }
  return {
    authenticated: Boolean(accountId),
    profileConfigured,
    publicProfile,
    rulesVersion: COMMUNITY_RULES_VERSION,
    acceptedRulesVersion,
    rulesText: COMMUNITY_RULES_TEXT,
    reportReasons: COMMUNITY_REPORT_REASONS,
  };
}

export type CommunityPost = {
  id: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
  commentCount: number;
  isMine: boolean;
  author: Pick<PublicProfile, "displayName" | "avatarId" | "bio">;
};

type FeedCursor = { sort: CommunityFeedSort; createdAt: string; id: string; commentCount: number };
type CommunityPostPage = { posts: CommunityPost[]; nextCursor: string | null; hasMore: boolean };
type SavedPostCursor = { savedAt: string; postId: string };

const POST_VISIBLE_TO_VIEWER = `NOT EXISTS(
  SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=? AND b.blocked_user_id=p.author_user_id
) AND (p.author_user_id=? OR NOT EXISTS(
  SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=p.author_user_id AND b.blocked_user_id=?
))`;

function encodeFeedCursor(post: CommunityPost, sort: CommunityFeedSort) {
  return encodeURIComponent(JSON.stringify({ v: 1, sort, createdAt: post.createdAt, id: post.id, commentCount: post.commentCount }));
}

function decodeFeedCursor(value: string | null, sort: CommunityFeedSort): FeedCursor | null {
  if (!value) return null;
  if (value.length > 512) throwCommunity("INVALID_CURSOR", 400);
  try {
    const cursor = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    if (cursor.v !== 1 || cursor.sort !== sort || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt)) || !validId(cursor.id) || !Number.isSafeInteger(cursor.commentCount) || Number(cursor.commentCount) < 0) {
      throwCommunity("INVALID_CURSOR", 400);
    }
    return { sort, createdAt: cursor.createdAt, id: cursor.id, commentCount: Number(cursor.commentCount) };
  } catch (error) {
    if (error instanceof CommunityError) throw error;
    throwCommunity("INVALID_CURSOR", 400);
  }
}

export async function listCommunityPostsPage(database: CommunityDatabase, viewerId: string | null, options: {
  sort?: CommunityFeedSort; cursor?: string | null; pageSize?: number;
} = {}): Promise<CommunityPostPage> {
  const sort: CommunityFeedSort = options.sort === "popular" ? "popular" : "recent";
  const cursor = decodeFeedCursor(options.cursor || null, sort);
  const pageSize = Math.max(1, Math.min(30, Math.trunc(options.pageSize || 20)));
  const cursorWhere = !cursor ? "" : sort === "popular"
    ? "WHERE comment_count < ? OR (comment_count=? AND (created_at < ? OR (created_at=? AND id < ?)))"
    : "WHERE created_at < ? OR (created_at=? AND id < ?)";
  const cursorValues = !cursor ? [] : sort === "popular"
    ? [cursor.commentCount, cursor.commentCount, cursor.createdAt, cursor.createdAt, cursor.id]
    : [cursor.createdAt, cursor.createdAt, cursor.id];
  const ordering = sort === "popular" ? "comment_count DESC, created_at DESC, id DESC" : "created_at DESC, id DESC";
  const rows = await database.prepare(`
    WITH visible_posts AS (
      SELECT p.id, p.body, p.created_at, p.edited_at, p.author_user_id,
        pp.display_name, pp.avatar_id, pp.bio, COUNT(c.id) AS comment_count
      FROM community_posts p
      JOIN public_profiles pp ON pp.user_id=p.author_user_id
      LEFT JOIN community_comments c ON c.post_id=p.id AND c.moderation_status='visible'
        AND (? IS NULL OR (
          NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=? AND b.blocked_user_id=c.author_user_id)
          AND (c.author_user_id=? OR NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=c.author_user_id AND b.blocked_user_id=?))
        ))
      WHERE p.moderation_status='visible' AND length(trim(pp.display_name)) > 0
        AND pp.avatar_id IN (${PUBLIC_AVATAR_IDS.map(() => "?").join(",")})
        AND (? IS NULL OR (
          NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=? AND b.blocked_user_id=p.author_user_id)
          AND (p.author_user_id=? OR NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=p.author_user_id AND b.blocked_user_id=?))
        ))
      GROUP BY p.id, p.body, p.created_at, p.edited_at, p.author_user_id, pp.display_name, pp.avatar_id, pp.bio
    )
    SELECT * FROM visible_posts ${cursorWhere}
    ORDER BY ${ordering} LIMIT ?
  `).bind(viewerId, viewerId, viewerId, viewerId, ...PUBLIC_AVATAR_IDS, viewerId, viewerId, viewerId, viewerId, ...cursorValues, pageSize + 1).all<Record<string, unknown>>();
  const posts = (rows.results || []).flatMap((row) => {
    const author = validatePublicProfile({ displayName: row.display_name, avatarId: row.avatar_id, bio: row.bio });
    if (!author?.ok) return [];
    return [{
      id: String(row.id), text: String(row.body), createdAt: String(row.created_at),
      editedAt: typeof row.edited_at === "string" ? row.edited_at : null,
      commentCount: Number(row.comment_count) || 0,
      isMine: Boolean(viewerId && row.author_user_id === viewerId),
      author: author.value,
    }];
  });
  const hasMore = posts.length > pageSize;
  const pagePosts = posts.slice(0, pageSize);
  return { posts: pagePosts, hasMore, nextCursor: hasMore && pagePosts.length ? encodeFeedCursor(pagePosts[pagePosts.length - 1], sort) : null };
}

export async function listCommunityPosts(database: CommunityDatabase, viewerId: string | null): Promise<CommunityPost[]> {
  return (await listCommunityPostsPage(database, viewerId, { pageSize: 30 })).posts;
}

function encodeSavedPostCursor(savedAt: string, postId: string) {
  return encodeURIComponent(JSON.stringify({ v: 1, savedAt, postId }));
}

function decodeSavedPostCursor(value: string | null): SavedPostCursor | null {
  if (!value) return null;
  if (value.length > 512) throwCommunity("INVALID_CURSOR", 400);
  try {
    const cursor = JSON.parse(decodeURIComponent(value)) as Record<string, unknown>;
    if (cursor.v !== 1 || typeof cursor.savedAt !== "string" || !Number.isFinite(Date.parse(cursor.savedAt)) || !validId(cursor.postId)) {
      throwCommunity("INVALID_CURSOR", 400);
    }
    return { savedAt: cursor.savedAt, postId: cursor.postId };
  } catch (error) {
    if (error instanceof CommunityError) throw error;
    throwCommunity("INVALID_CURSOR", 400);
  }
}

/** Private, current-version posts only; no saved timestamp or other user's relation is returned. */
export async function listCommunitySavedPostsPage(database: CommunityDatabase, accountId: string, options: {
  cursor?: string | null; pageSize?: number;
} = {}): Promise<CommunityPostPage> {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  const cursor = decodeSavedPostCursor(options.cursor || null);
  const pageSize = Math.max(1, Math.min(30, Math.trunc(options.pageSize || 20)));
  const cursorWhere = cursor ? "AND (s.saved_at < ? OR (s.saved_at=? AND p.id < ?))" : "";
  const cursorValues = cursor ? [cursor.savedAt, cursor.savedAt, cursor.postId] : [];
  const rows = await database.prepare(`
    SELECT p.id, p.body, p.created_at, p.edited_at, p.author_user_id, s.saved_at,
      pp.display_name, pp.avatar_id, pp.bio, COUNT(c.id) AS comment_count
    FROM community_saved_posts s
    JOIN community_posts p ON p.id=s.post_id
    JOIN public_profiles pp ON pp.user_id=p.author_user_id
    LEFT JOIN community_comments c ON c.post_id=p.id AND c.moderation_status='visible'
      AND NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=? AND b.blocked_user_id=c.author_user_id)
      AND (c.author_user_id=? OR NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=c.author_user_id AND b.blocked_user_id=?))
    WHERE s.user_id=? AND p.moderation_status='visible' AND length(trim(pp.display_name)) > 0
      AND pp.avatar_id IN (${PUBLIC_AVATAR_IDS.map(() => "?").join(",")})
      AND ${POST_VISIBLE_TO_VIEWER} ${cursorWhere}
    GROUP BY p.id, p.body, p.created_at, p.edited_at, p.author_user_id, s.saved_at,
      pp.display_name, pp.avatar_id, pp.bio
    ORDER BY s.saved_at DESC, p.id DESC LIMIT ?
  `).bind(accountId, accountId, accountId, accountId, ...PUBLIC_AVATAR_IDS, accountId, accountId, accountId, ...cursorValues, pageSize + 1).all<Record<string, unknown>>();
  const visible = (rows.results || []).flatMap((row) => {
    const author = validatePublicProfile({ displayName: row.display_name, avatarId: row.avatar_id, bio: row.bio });
    if (!author?.ok) return [];
    return [{
      savedAt: String(row.saved_at),
      post: {
        id: String(row.id), text: String(row.body), createdAt: String(row.created_at),
        editedAt: typeof row.edited_at === "string" ? row.edited_at : null,
        commentCount: Number(row.comment_count) || 0,
        isMine: row.author_user_id === accountId,
        author: author.value,
      } satisfies CommunityPost,
    }];
  });
  const hasMore = visible.length > pageSize;
  const page = visible.slice(0, pageSize);
  const last = page.at(-1);
  return {
    posts: page.map(({ post }) => post),
    hasMore,
    nextCursor: hasMore && last ? encodeSavedPostCursor(last.savedAt, last.post.id) : null,
  };
}

/** Return only this session's saved IDs for a bounded page of already-visible posts. */
export async function listSavedCommunityPostIds(database: CommunityDatabase, accountId: string, postIds: unknown[]) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!Array.isArray(postIds) || postIds.length > 30 || postIds.some((id) => !validId(id))) throwCommunity("INVALID_TARGET", 400);
  const ids = [...new Set(postIds as string[])];
  if (!ids.length) return [];
  const rows = await database.prepare(`
    SELECT p.id FROM community_saved_posts s
    JOIN community_posts p ON p.id=s.post_id
    JOIN public_profiles pp ON pp.user_id=p.author_user_id
    WHERE s.user_id=? AND p.id IN (${ids.map(() => "?").join(",")})
      AND p.moderation_status='visible' AND length(trim(pp.display_name)) > 0
      AND pp.avatar_id IN (${PUBLIC_AVATAR_IDS.map(() => "?").join(",")})
      AND ${POST_VISIBLE_TO_VIEWER}
  `).bind(accountId, ...ids, ...PUBLIC_AVATAR_IDS, accountId, accountId, accountId).all<{ id: string }>();
  return (rows.results || []).map((row) => String(row.id));
}

/** Insert-select makes visibility and saved-state creation one D1 statement; the primary key is the duplicate guard. */
export async function saveCommunityPost(database: CommunityDatabase, accountId: string, postId: string, now = Date.now()) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!validId(postId)) throwCommunity("NOT_FOUND", 404);
  const result = await database.prepare(`
    INSERT OR IGNORE INTO community_saved_posts(user_id, post_id, saved_at)
    SELECT ?, p.id, ? FROM community_posts p
    JOIN public_profiles pp ON pp.user_id=p.author_user_id
    WHERE p.id=? AND p.moderation_status='visible' AND length(trim(pp.display_name)) > 0
      AND pp.avatar_id IN (${PUBLIC_AVATAR_IDS.map(() => "?").join(",")})
      AND ${POST_VISIBLE_TO_VIEWER}
  `).bind(accountId, new Date(now).toISOString(), postId, ...PUBLIC_AVATAR_IDS, accountId, accountId, accountId).run();
  if (Number(result.meta?.changes ?? 0) > 0) return { saved: true, alreadySaved: false };
  const existing = await database.prepare(`
    SELECT 1 AS found FROM community_saved_posts s
    JOIN community_posts p ON p.id=s.post_id
    JOIN public_profiles pp ON pp.user_id=p.author_user_id
    WHERE s.user_id=? AND p.id=? AND p.moderation_status='visible'
      AND length(trim(pp.display_name)) > 0 AND pp.avatar_id IN (${PUBLIC_AVATAR_IDS.map(() => "?").join(",")})
      AND ${POST_VISIBLE_TO_VIEWER}
  `).bind(accountId, postId, ...PUBLIC_AVATAR_IDS, accountId, accountId, accountId).first();
  if (existing) return { saved: true, alreadySaved: true };
  throwCommunity("NOT_FOUND", 404);
}

export async function removeCommunitySavedPost(database: CommunityDatabase, accountId: string, postId: string) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!validId(postId)) throwCommunity("NOT_FOUND", 404);
  await database.prepare("DELETE FROM community_saved_posts WHERE user_id=? AND post_id=?").bind(accountId, postId).run();
  return { saved: false };
}

export type CommunityComment = {
  id: string;
  postId: string;
  text: string;
  createdAt: string;
  editedAt: string | null;
  isMine: boolean;
  author: Pick<PublicProfile, "displayName" | "avatarId" | "bio">;
};

export async function listCommunityComments(database: CommunityDatabase, postId: string, viewerId: string | null): Promise<CommunityComment[]> {
  if (!validId(postId)) throwCommunity("NOT_FOUND", 404);
  const exists = await database.prepare("SELECT id FROM community_posts WHERE id=? AND moderation_status='visible'")
    .bind(postId).first<{ id: string }>();
  if (!exists) throwCommunity("NOT_FOUND", 404);
  const rows = await database.prepare(`
    SELECT c.id, c.post_id, c.body, c.created_at, c.edited_at, c.author_user_id,
      pp.display_name, pp.avatar_id
    FROM community_comments c JOIN public_profiles pp ON pp.user_id=c.author_user_id
    WHERE c.post_id=? AND c.moderation_status='visible' AND length(trim(pp.display_name)) > 0
      AND pp.avatar_id IN (${PUBLIC_AVATAR_IDS.map(() => "?").join(",")})
      AND (? IS NULL OR (
        NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=? AND b.blocked_user_id=c.author_user_id)
        AND (c.author_user_id=? OR NOT EXISTS(SELECT 1 FROM community_blocks b WHERE b.blocker_user_id=c.author_user_id AND b.blocked_user_id=?))
      ))
    ORDER BY c.created_at ASC, c.id ASC LIMIT 100
  `).bind(postId, ...PUBLIC_AVATAR_IDS, viewerId, viewerId, viewerId, viewerId).all<Record<string, unknown>>();
  return (rows.results || []).flatMap((row) => {
    const author = validatePublicProfile({ displayName: row.display_name, avatarId: row.avatar_id, bio: row.bio });
    if (!author?.ok) return [];
    return [{
      id: String(row.id), postId: String(row.post_id), text: String(row.body), createdAt: String(row.created_at),
      editedAt: typeof row.edited_at === "string" ? row.edited_at : null,
      isMine: Boolean(viewerId && row.author_user_id === viewerId), author: author.value,
    }];
  });
}

export async function createCommunityPost(database: CommunityDatabase, accountId: string, input: unknown, now = Date.now(), classifier: CommunityDraftClassifier = localDraftClassifier) {
  await assertReady(database, accountId);
  const text = normalizedText(input, MAX_POST_LENGTH);
  await consumeRateLimit(database, accountId, "post", now);
  const id = crypto.randomUUID();
  const decision = await decideDraft(database, accountId, "post", text, now, classifier);
  await database.batch([
    database.prepare("INSERT INTO community_posts(id, author_user_id, body, created_at, moderation_status, moderated_at) VALUES(?, ?, ?, ?, ?, ?)")
      .bind(id, accountId, text, new Date(now).toISOString(), decision.decision === "approved" ? "visible" : "hidden",
        decision.decision === "approved" ? null : new Date(now).toISOString()),
    preModerationInsert(database, "post", id, decision, now), preModerationEvent(database, "post", id, decision, now),
  ]);
  return { id, text, moderationStatus: decision.decision };
}

export async function editCommunityPost(database: CommunityDatabase, accountId: string, postId: string, input: unknown, now = Date.now(), classifier: CommunityDraftClassifier = localDraftClassifier) {
  await assertReady(database, accountId);
  if (!validId(postId)) throwCommunity("NOT_FOUND", 404);
  const text = normalizedText(input, MAX_POST_LENGTH);
  const owned = await database.prepare("SELECT 1 AS found FROM community_posts WHERE id=? AND author_user_id=? AND moderation_status='visible'")
    .bind(postId, accountId).first();
  if (!owned) {
    const owner = await database.prepare("SELECT 1 AS found FROM community_posts WHERE id=? AND author_user_id=?")
      .bind(postId, accountId).first();
    if (owner) throwCommunity("NOT_FOUND", 404);
    const exists = await database.prepare("SELECT 1 AS found FROM community_posts WHERE id=?")
      .bind(postId).first();
    throwCommunity(exists ? "NOT_OWNER" : "NOT_FOUND", exists ? 403 : 404);
  }
  const decision = await decideDraft(database, accountId, "post", text, now, classifier);
  await database.batch([
    database.prepare("UPDATE community_posts SET body=?, edited_at=?, moderation_status=?, moderated_at=? WHERE id=? AND author_user_id=? AND moderation_status='visible'")
      .bind(text, new Date(now).toISOString(), decision.decision === "approved" ? "visible" : "hidden",
        decision.decision === "approved" ? null : new Date(now).toISOString(), postId, accountId),
    database.prepare(`INSERT INTO community_pre_moderation(target_type, post_id, decision, categories, confidence, reason, decision_source, created_at, reviewed_by, reviewed_at)
      VALUES('post', ?, ?, ?, ?, ?, 'automatic', ?, NULL, NULL)
      ON CONFLICT(post_id) WHERE post_id IS NOT NULL DO UPDATE SET decision=excluded.decision, categories=excluded.categories,
      confidence=excluded.confidence, reason=excluded.reason, decision_source='automatic',
      created_at=excluded.created_at, reviewed_by=NULL, reviewed_at=NULL`)
      .bind(postId, decision.decision, JSON.stringify(decision.categories), decision.confidence, decision.reason, new Date(now).toISOString()),
    preModerationEvent(database, "post", postId, decision, now),
  ]);
  return { id: postId, text, editedAt: new Date(now).toISOString(), moderationStatus: decision.decision };
}

export async function deleteCommunityPost(database: CommunityDatabase, accountId: string, postId: string) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!validId(postId)) throwCommunity("NOT_FOUND", 404);
  const result = await database.prepare("DELETE FROM community_posts WHERE id=? AND author_user_id=?")
    .bind(postId, accountId).run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    const exists = await database.prepare("SELECT 1 AS found FROM community_posts WHERE id=?")
      .bind(postId).first();
    throwCommunity(exists ? "NOT_OWNER" : "NOT_FOUND", exists ? 403 : 404);
  }
  return { deleted: true };
}

export async function createCommunityComment(database: CommunityDatabase, accountId: string, postId: string, input: unknown, now = Date.now(), classifier: CommunityDraftClassifier = localDraftClassifier) {
  await assertReady(database, accountId);
  if (!validId(postId)) throwCommunity("NOT_FOUND", 404);
  const post = await database.prepare("SELECT id FROM community_posts WHERE id=? AND moderation_status='visible'")
    .bind(postId).first();
  if (!post) throwCommunity("NOT_FOUND", 404);
  const text = normalizedText(input, MAX_COMMENT_LENGTH);
  await consumeRateLimit(database, accountId, "comment", now);
  const id = crypto.randomUUID();
  const decision = await decideDraft(database, accountId, "comment", text, now, classifier);
  await database.batch([
    database.prepare("INSERT INTO community_comments(id, post_id, author_user_id, body, created_at, moderation_status, moderated_at) VALUES(?, ?, ?, ?, ?, ?, ?)")
      .bind(id, postId, accountId, text, new Date(now).toISOString(), decision.decision === "approved" ? "visible" : "hidden",
        decision.decision === "approved" ? null : new Date(now).toISOString()),
    preModerationInsert(database, "comment", id, decision, now), preModerationEvent(database, "comment", id, decision, now),
  ]);
  return { id, postId, text, moderationStatus: decision.decision };
}

export async function editCommunityComment(database: CommunityDatabase, accountId: string, commentId: string, input: unknown, now = Date.now(), classifier: CommunityDraftClassifier = localDraftClassifier) {
  await assertReady(database, accountId);
  if (!validId(commentId)) throwCommunity("NOT_FOUND", 404);
  const text = normalizedText(input, MAX_COMMENT_LENGTH);
  const owned = await database.prepare("SELECT 1 AS found FROM community_comments WHERE id=? AND author_user_id=? AND moderation_status='visible'")
    .bind(commentId, accountId).first();
  if (!owned) {
    const exists = await database.prepare("SELECT 1 AS found FROM community_comments WHERE id=?")
      .bind(commentId).first();
    if (!exists) throwCommunity("NOT_FOUND", 404);
    const owner = await database.prepare("SELECT 1 AS found FROM community_comments WHERE id=? AND author_user_id=?")
      .bind(commentId, accountId).first();
    throwCommunity(owner ? "NOT_FOUND" : "NOT_OWNER", owner ? 404 : 403);
  }
  const decision = await decideDraft(database, accountId, "comment", text, now, classifier);
  await database.batch([
    database.prepare("UPDATE community_comments SET body=?, edited_at=?, moderation_status=?, moderated_at=? WHERE id=? AND author_user_id=? AND moderation_status='visible'")
      .bind(text, new Date(now).toISOString(), decision.decision === "approved" ? "visible" : "hidden",
        decision.decision === "approved" ? null : new Date(now).toISOString(), commentId, accountId),
    database.prepare(`INSERT INTO community_pre_moderation(target_type, comment_id, decision, categories, confidence, reason, decision_source, created_at, reviewed_by, reviewed_at)
      VALUES('comment', ?, ?, ?, ?, ?, 'automatic', ?, NULL, NULL)
      ON CONFLICT(comment_id) WHERE comment_id IS NOT NULL DO UPDATE SET decision=excluded.decision, categories=excluded.categories,
      confidence=excluded.confidence, reason=excluded.reason, decision_source='automatic',
      created_at=excluded.created_at, reviewed_by=NULL, reviewed_at=NULL`)
      .bind(commentId, decision.decision, JSON.stringify(decision.categories), decision.confidence, decision.reason, new Date(now).toISOString()),
    preModerationEvent(database, "comment", commentId, decision, now),
  ]);
  return { id: commentId, text, editedAt: new Date(now).toISOString(), moderationStatus: decision.decision };
}

export async function deleteCommunityComment(database: CommunityDatabase, accountId: string, commentId: string) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!validId(commentId)) throwCommunity("NOT_FOUND", 404);
  const result = await database.prepare("DELETE FROM community_comments WHERE id=? AND author_user_id=?")
    .bind(commentId, accountId).run();
  if (Number(result.meta?.changes ?? 0) === 0) {
    const exists = await database.prepare("SELECT 1 AS found FROM community_comments WHERE id=?")
      .bind(commentId).first();
    throwCommunity(exists ? "NOT_OWNER" : "NOT_FOUND", exists ? 403 : 404);
  }
  return { deleted: true };
}

export async function reportCommunityContent(database: CommunityDatabase, accountId: string, input: {
  targetType?: unknown; targetId?: unknown; reason?: unknown;
}, now = Date.now()) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  const targetType = input.targetType;
  const targetId = input.targetId;
  const reason = input.reason;
  if ((targetType !== "post" && targetType !== "comment") || !validId(targetId)) throwCommunity("INVALID_TARGET", 400);
  if (typeof reason !== "string" || !COMMUNITY_REPORT_REASONS.includes(reason as CommunityReportReason)) throwCommunity("INVALID_REASON", 400);
  const table = targetType === "post" ? "community_posts" : "community_comments";
  const target = await database.prepare(`SELECT author_user_id${targetType === "comment" ? ", post_id" : ""} FROM ${table} WHERE id=? AND moderation_status='visible'`)
    .bind(targetId).first<{ author_user_id: string; post_id?: string }>();
  if (!target || (target.post_id && !await database.prepare("SELECT 1 AS found FROM community_posts WHERE id=? AND moderation_status='visible'").bind(target.post_id).first())) throwCommunity("NOT_FOUND", 404);
  if (target.author_user_id === accountId) throwCommunity("INVALID_TARGET", 400);
  const targetColumns = targetType === "post" ? { postId: targetId, commentId: null } : { postId: null, commentId: targetId };
  const duplicateSql = targetType === "post"
    ? "SELECT 1 AS found FROM community_reports WHERE reporter_user_id=? AND post_id=?"
    : "SELECT 1 AS found FROM community_reports WHERE reporter_user_id=? AND comment_id=?";
  if (await database.prepare(duplicateSql).bind(accountId, targetId).first()) throwCommunity("DUPLICATE_REPORT", 409);
  await consumeRateLimit(database, accountId, "report", now);
  const id = crypto.randomUUID();
  try {
    await database.prepare(`INSERT INTO community_reports(id, reporter_user_id, target_type, post_id, comment_id, reason, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, accountId, targetType, targetColumns.postId, targetColumns.commentId, reason, new Date(now).toISOString()).run();
  } catch {
    if (await database.prepare(duplicateSql).bind(accountId, targetId).first()) throwCommunity("DUPLICATE_REPORT", 409);
    throw new Error("Community report insert failed");
  }
  return { id, reported: true };
}

export async function blockAuthorFromPost(database: CommunityDatabase, accountId: string, postId: unknown, now = Date.now()) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!validId(postId)) throwCommunity("INVALID_TARGET", 400);
  const target = await database.prepare("SELECT author_user_id FROM community_posts WHERE id=? AND moderation_status='visible'")
    .bind(postId).first<{ author_user_id: string }>();
  if (!target) throwCommunity("NOT_FOUND", 404);
  if (target.author_user_id === accountId) throwCommunity("SELF_BLOCK", 400);
  if (await database.prepare("SELECT 1 AS found FROM community_blocks WHERE blocker_user_id=? AND blocked_user_id=?")
    .bind(accountId, target.author_user_id).first()) throwCommunity("DUPLICATE_BLOCK", 409);
  const id = crypto.randomUUID();
  try {
    await database.prepare("INSERT INTO community_blocks(id, blocker_user_id, blocked_user_id, created_at) VALUES(?, ?, ?, ?)")
      .bind(id, accountId, target.author_user_id, new Date(now).toISOString()).run();
  } catch {
    if (await database.prepare("SELECT 1 AS found FROM community_blocks WHERE blocker_user_id=? AND blocked_user_id=?")
      .bind(accountId, target.author_user_id).first()) throwCommunity("DUPLICATE_BLOCK", 409);
    throw new Error("Community block insert failed");
  }
  return { id, blocked: true };
}

export async function listCommunityBlocks(database: CommunityDatabase, accountId: string) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  const rows = await database.prepare(`
    SELECT b.id, b.created_at, p.display_name, p.avatar_id, p.bio
    FROM community_blocks b JOIN public_profiles p ON p.user_id=b.blocked_user_id
    WHERE b.blocker_user_id=? ORDER BY b.created_at DESC LIMIT 100
  `).bind(accountId).all<Record<string, unknown>>();
  return (rows.results || []).flatMap((row) => {
    const profile = validatePublicProfile({ displayName: row.display_name, avatarId: row.avatar_id, bio: row.bio });
    return profile?.ok ? [{ id: String(row.id), createdAt: String(row.created_at), profile: profile.value }] : [];
  });
}

export async function deleteCommunityBlock(database: CommunityDatabase, accountId: string, blockId: unknown) {
  if (!validId(accountId)) throwCommunity("AUTH_REQUIRED", 401);
  if (!validId(blockId)) throwCommunity("BLOCK_NOT_FOUND", 404);
  const result = await database.prepare("DELETE FROM community_blocks WHERE id=? AND blocker_user_id=?")
    .bind(blockId, accountId).run();
  if (Number(result.meta?.changes ?? 0) === 0) throwCommunity("BLOCK_NOT_FOUND", 404);
  return { deleted: true };
}

export async function isCommunityModerator(database: CommunityDatabase, accountId: string) {
  if (!validId(accountId)) return false;
  return Boolean(await database.prepare("SELECT 1 AS found FROM community_moderators WHERE user_id=?")
    .bind(accountId).first());
}

export async function listOpenCommunityReports(database: CommunityDatabase) {
  const rows = await database.prepare(`
    SELECT r.id, r.target_type, r.post_id, r.comment_id, r.reason, r.created_at,
      CASE WHEN r.target_type='post' THEN p.body ELSE c.body END AS body,
      CASE WHEN r.target_type='post' THEN p.author_user_id ELSE c.author_user_id END AS content_author,
      pp.display_name, pp.avatar_id, pp.bio
    FROM community_reports r
    LEFT JOIN community_posts p ON r.post_id=p.id
    LEFT JOIN community_comments c ON r.comment_id=c.id
    JOIN public_profiles pp ON pp.user_id=CASE WHEN r.target_type='post' THEN p.author_user_id ELSE c.author_user_id END
    WHERE r.status='open' ORDER BY r.created_at ASC LIMIT 100
  `).bind().all<Record<string, unknown>>();
  return (rows.results || []).map((row) => ({
    id: String(row.id),
    targetType: String(row.target_type),
    targetId: String(row.post_id || row.comment_id),
    reason: String(row.reason),
    createdAt: String(row.created_at),
    text: String(row.body || ""),
    author: {
      displayName: String(row.display_name || ""),
      avatarId: String(row.avatar_id || "avatar_01"),
    },
  }));
}

export async function moderateCommunityContent(database: CommunityDatabase, moderatorId: string, input: {
  targetType?: unknown; targetId?: unknown; action?: unknown; reason?: unknown;
}, now = Date.now()) {
  if (!await isCommunityModerator(database, moderatorId)) throwCommunity("MODERATOR_REQUIRED", 403);
  const { targetType, targetId, action, reason } = input;
  if ((targetType !== "post" && targetType !== "comment") || !validId(targetId) || !["hide", "restore", "remove"].includes(String(action))) throwCommunity("INVALID_TARGET", 400);
  if (typeof reason !== "string" || !COMMUNITY_REPORT_REASONS.includes(reason as CommunityReportReason)) throwCommunity("INVALID_REASON", 400);
  const table = targetType === "post" ? "community_posts" : "community_comments";
  const exists = await database.prepare(`SELECT id FROM ${table} WHERE id=?`).bind(targetId).first();
  if (!exists) throwCommunity("NOT_FOUND", 404);
  if (action === "restore" && await database.prepare(`SELECT 1 AS found FROM community_pre_moderation
    WHERE ${targetType === "post" ? "post_id" : "comment_id"}=? AND decision<>'approved'`).bind(targetId).first()) {
    throwCommunity("INVALID_TARGET", 409);
  }
  const status = action === "restore" ? "visible" : action === "hide" ? "hidden" : "removed";
  const targetColumns = targetType === "post" ? { postId: targetId, commentId: null } : { postId: null, commentId: targetId };
  const statements = [
    database.prepare(`UPDATE ${table} SET body=CASE WHEN ?='remove' THEN 'Contenido retirado por moderación' ELSE body END,
      moderation_status=?, moderated_at=?, moderation_reason=? WHERE id=?`)
      .bind(action, status, action === "restore" ? null : new Date(now).toISOString(), action === "restore" ? null : reason, targetId),
    database.prepare(`INSERT INTO community_moderation_events(id, actor_user_id, target_type, post_id, comment_id, action, reason, created_at)
      VALUES(?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), moderatorId, targetType, targetColumns.postId, targetColumns.commentId, action, reason, new Date(now).toISOString()),
    database.prepare(`UPDATE community_reports SET status=? WHERE ${targetType === "post" ? "post_id" : "comment_id"}=? AND status='open'`)
      .bind(action === "remove" || action === "hide" ? "actioned" : "reviewed", targetId),
  ];
  await database.batch(statements);
  return { moderated: true, status };
}

/** Purges moderated content after 90 days while retaining detached minimal audit metadata. */
export async function purgeExpiredCommunityContent(database: CommunityDatabase, now = Date.now()) {
  const cutoff = new Date(now - MODERATED_CONTENT_RETENTION_MS).toISOString();
  // A parent's expiry also expires its comments. Delete comments first so a
  // post deletion never cascades through an unbounded number of children.
  const expiredComments = `SELECT c.id FROM community_comments c JOIN community_posts p ON p.id=c.post_id
    WHERE (c.moderation_status IN ('hidden','removed') AND datetime(c.moderated_at)<=datetime(?))
       OR (p.moderation_status IN ('hidden','removed') AND datetime(p.moderated_at)<=datetime(?))
    ORDER BY c.id LIMIT 25`;
  const expiredPosts = `SELECT p.id FROM community_posts p
    WHERE p.moderation_status IN ('hidden','removed') AND datetime(p.moderated_at)<=datetime(?)
      AND NOT EXISTS (SELECT 1 FROM community_comments c WHERE c.post_id=p.id)
    ORDER BY p.id LIMIT 25`;
  const results = await database.batch([
    database.prepare(`UPDATE community_moderation_events SET post_id=NULL,comment_id=NULL
      WHERE comment_id IN (${expiredComments})`).bind(cutoff, cutoff),
    database.prepare(`DELETE FROM community_comments WHERE id IN (${expiredComments})`).bind(cutoff, cutoff),
    database.prepare(`UPDATE community_moderation_events SET post_id=NULL,comment_id=NULL
      WHERE post_id IN (${expiredPosts})`).bind(cutoff),
    database.prepare(`DELETE FROM community_posts WHERE id IN (${expiredPosts})`).bind(cutoff),
  ]);
  return { postsPurged: Number(results[3]?.meta?.changes ?? 0), commentsPurged: Number(results[1]?.meta?.changes ?? 0),
    queries: results.length, rowsRead: results.reduce((total, result) => total + Number(result.meta?.rows_read || 0), 0),
    rowsWritten: results.reduce((total, result) => total + Number(result.meta?.rows_written || 0), 0) };
}

export function isCommunityReason(value: unknown): value is CommunityReportReason {
  return typeof value === "string" && COMMUNITY_REPORT_REASONS.includes(value as CommunityReportReason);
}
