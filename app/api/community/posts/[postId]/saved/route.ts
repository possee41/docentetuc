import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, removeCommunitySavedPost, saveCommunityPost } from "@/lib/community";
import { communitySavedPostsDatabase } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ postId: string }> };

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const { postId } = await params;
    const result = await saveCommunityPost(await communitySavedPostsDatabase(), account.accountId, postId);
    return Response.json(result, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const { postId } = await params;
    const result = await removeCommunitySavedPost(await communitySavedPostsDatabase(), account.accountId, postId);
    return Response.json(result, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}
