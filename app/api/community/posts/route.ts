import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, communityStatus, createCommunityPost, listCommunityPosts } from "@/lib/community";
import { communityDatabase, jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const database = await communityDatabase();
    const account = await getAuthenticatedAccount(request);
    const [status, posts] = await Promise.all([
      communityStatus(database, account?.accountId || null),
      listCommunityPosts(database, account?.accountId || null),
    ]);
    return Response.json({ status, posts }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const database = await communityDatabase();
    const body = await jsonObject(request);
    // Deliberately accept only text; client-supplied userId/device IDs are ignored.
    const post = await createCommunityPost(database, account.accountId, body.text);
    return Response.json(post, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
