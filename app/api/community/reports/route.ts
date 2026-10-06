import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, reportCommunityContent } from "@/lib/community";
import { communityDatabase, jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const account = await getAuthenticatedAccount(request);
    if (!account) return communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 });
    const body = await jsonObject(request);
    const result = await reportCommunityContent(await communityDatabase(), account.accountId, body);
    return Response.json(result, { status: 201, headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
