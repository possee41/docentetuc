import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, deleteCommunityBlock } from "@/lib/community";
import { communityDatabase } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ blockId: string }> };

export async function DELETE(request: Request, { params }: Context) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const { blockId } = await params;
    const result = await deleteCommunityBlock(await communityDatabase(), account.accountId, blockId);
    return Response.json(result, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
