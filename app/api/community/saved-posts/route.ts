import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, listCommunitySavedPostsPage } from "@/lib/community";
import { communitySavedPostsDatabase } from "@/lib/community-route";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const url = new URL(request.url);
    const page = await listCommunitySavedPostsPage(await communitySavedPostsDatabase(), account.accountId, {
      cursor: url.searchParams.get("cursor"),
      pageSize: 20,
    });
    return Response.json(page, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}
