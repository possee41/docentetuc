import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, createCommunityComment, listCommunityComments } from "@/lib/community";
import { communityDatabase, jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ postId: string }> };

export async function GET(request: Request, { params }: Context) {
  try {
    const account = await getAuthenticatedAccount(request);
    const { postId } = await params;
    const comments = await listCommunityComments(await communityDatabase(), postId, account?.accountId || null);
    return Response.json({ comments }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const body = await jsonObject(request);
    const { postId } = await params;
    const result = await createCommunityComment(await communityDatabase(), account.accountId, postId, body.text);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
