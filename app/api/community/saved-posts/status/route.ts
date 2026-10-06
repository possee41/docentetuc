import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, listSavedCommunityPostIds } from "@/lib/community";
import { communitySavedPostsDatabase } from "@/lib/community-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const postIds = await listSavedCommunityPostIds(
      await communitySavedPostsDatabase(),
      account.accountId,
      new URL(request.url).searchParams.getAll("postId"),
    );
    return Response.json({ postIds }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}
