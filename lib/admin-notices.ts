import { CommunityError, type CommunityDatabase } from "./community.ts";
import { requireCommunityAdmin } from "./community-admin.ts";

export type AdminNotice = {
  id: string; title: string; body: string; priority: "normal" | "importante" | "urgente";
  startsAt: string | null; endsAt: string | null; url: string | null; active: boolean;
  createdAt: string; updatedAt: string;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SELECT = `SELECT id, title, body, priority, starts_at AS startsAt, ends_at AS endsAt,
  url, active, created_at AS createdAt, updated_at AS updatedAt FROM admin_notices`;

function noticeFromRow(row: Record<string, unknown>): AdminNotice {
  return {
    id: String(row.id), title: String(row.title), body: String(row.body),
    priority: row.priority as AdminNotice["priority"], startsAt: row.startsAt as string | null,
    endsAt: row.endsAt as string | null, url: row.url as string | null,
    active: Boolean(row.active), createdAt: String(row.createdAt), updatedAt: String(row.updatedAt),
  };
}

export async function listAdminNotices(database: CommunityDatabase) {
  const rows = await database.prepare(`${SELECT} ORDER BY created_at DESC LIMIT 200`).bind().all<Record<string, unknown>>();
  return (rows.results || []).map(noticeFromRow);
}

export async function activeAdminNotices(database: CommunityDatabase, now = new Date()) {
  const rows = await database.prepare(`${SELECT} WHERE active=1
    AND (starts_at IS NULL OR starts_at<=?) AND (ends_at IS NULL OR ends_at>?)
    ORDER BY CASE priority WHEN 'urgente' THEN 0 WHEN 'importante' THEN 1 ELSE 2 END, created_at DESC LIMIT 10`)
    .bind(now.toISOString(), now.toISOString()).all<Record<string, unknown>>();
  return (rows.results || []).map(noticeFromRow);
}

function optionalDate(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) throw new CommunityError("INVALID_NOTICE", 400);
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) throw new CommunityError("INVALID_NOTICE", 400);
  return date.toISOString();
}

function optionalUrl(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 1000) throw new CommunityError("INVALID_NOTICE", 400);
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error();
    return url.href;
  } catch { throw new CommunityError("INVALID_NOTICE", 400); }
}

export function validateAdminNotice(input: Record<string, unknown>) {
  const title = typeof input.title === "string" ? input.title.trim() : "";
  const body = typeof input.body === "string" ? input.body.trim() : "";
  const priority = input.priority;
  if (!title || title.length > 140 || !body || body.length > 2000 ||
    !["normal", "importante", "urgente"].includes(String(priority)) || typeof input.active !== "boolean") {
    throw new CommunityError("INVALID_NOTICE", 400);
  }
  const startsAt = optionalDate(input.startsAt), endsAt = optionalDate(input.endsAt);
  if (startsAt && endsAt && endsAt <= startsAt) throw new CommunityError("INVALID_NOTICE", 400);
  return { title, body, priority: priority as AdminNotice["priority"], startsAt, endsAt, url: optionalUrl(input.url), active: input.active };
}

export async function saveAdminNotice(database: CommunityDatabase, actorId: string, input: Record<string, unknown>) {
  await requireCommunityAdmin(database, actorId);
  const value = validateAdminNotice(input), id = input.id;
  if (id !== undefined && (typeof id !== "string" || !UUID.test(id))) throw new CommunityError("INVALID_NOTICE", 400);
  const noticeId = typeof id === "string" ? id : crypto.randomUUID();
  if (id) {
    const existing = await database.prepare("SELECT 1 AS found FROM admin_notices WHERE id=?").bind(id).first();
    if (!existing) throw new CommunityError("NOT_FOUND", 404);
  }
  const now = new Date().toISOString();
  const statement = id
    ? database.prepare(`UPDATE admin_notices SET title=?, body=?, priority=?, starts_at=?, ends_at=?, url=?, active=?, updated_at=?, updated_by=? WHERE id=?`)
      .bind(value.title, value.body, value.priority, value.startsAt, value.endsAt, value.url, Number(value.active), now, actorId, noticeId)
    : database.prepare(`INSERT INTO admin_notices(id,title,body,priority,starts_at,ends_at,url,active,created_at,updated_at,created_by,updated_by)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).bind(noticeId, value.title, value.body, value.priority, value.startsAt, value.endsAt, value.url, Number(value.active), now, now, actorId, actorId);
  const results = await database.batch([statement,
    database.prepare("INSERT INTO admin_notice_events(id,notice_id,actor_user_id,action,created_at) VALUES(?,?,?,?,?)")
      .bind(crypto.randomUUID(), noticeId, actorId, id ? "edit" : "create", now)]);
  if (Number(results[0]?.meta?.changes || 0) !== 1) throw new CommunityError("INVALID_NOTICE", 409);
  return { id: noticeId };
}
