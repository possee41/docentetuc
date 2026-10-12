import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse } from "@/lib/community";
import { communityWriteDatabase } from "@/lib/community-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const database = await communityWriteDatabase();
    const rows = await database.prepare(`
      SELECT 'post' AS type, m.decision, p.body AS text, m.created_at AS createdAt
      FROM community_pre_moderation m JOIN community_posts p ON p.id=m.post_id
      WHERE p.author_user_id=? AND m.decision<>'approved'
      UNION ALL
      SELECT 'comment', m.decision, c.body, m.created_at
      FROM community_pre_moderation m JOIN community_comments c ON c.id=m.comment_id
      WHERE c.author_user_id=? AND m.decision<>'approved'
      ORDER BY createdAt DESC LIMIT 30
    `).bind(account.accountId, account.accountId).all();
    return Response.json({ items: rows.results || [] }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}
