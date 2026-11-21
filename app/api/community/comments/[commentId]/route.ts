import { env } from "cloudflare:workers";
import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, deleteCommunityComment, editCommunityComment } from "@/lib/community";
import { communityDatabase, communityWriteDatabase, jsonObject } from "@/lib/community-route";
import { geminiDraftClassifier } from "@/lib/community-pre-moderation";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ commentId: string }> };

export async function PATCH(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const body = await jsonObject(request);
    const { commentId } = await params;
    const settings = env as unknown as Record<string, string | undefined>;
    const result = await editCommunityComment(await communityWriteDatabase(), account.accountId, commentId, body.text, Date.now(), geminiDraftClassifier({
      provider: settings.AI_PROVIDER, apiKey: settings.AI_API_KEY, model: settings.AI_MODEL,
    }));
    return Response.json(result, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const { commentId } = await params;
    const result = await deleteCommunityComment(await communityDatabase(), account.accountId, commentId);
    return Response.json(result, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
