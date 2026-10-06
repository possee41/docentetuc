import { getAuthenticatedAccount } from "@/lib/auth-session";
import { blockAuthorFromPost, communityErrorResponse, listCommunityBlocks } from "@/lib/community";
import { communityDatabase, jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const blocks = await listCommunityBlocks(await communityDatabase(), account.accountId);
    return Response.json({ blocks }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const body = await jsonObject(request);
    const result = await blockAuthorFromPost(await communityDatabase(), account.accountId, body.postId);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
