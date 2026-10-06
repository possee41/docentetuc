import { getAuthenticatedAccount } from "@/lib/auth-session";
import { communityErrorResponse, isCommunityModerator, listOpenCommunityReports, moderateCommunityContent } from "@/lib/community";
import { communityDatabase, jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

async function moderator(request: Request) {
  const account = await getAuthenticatedAccount(request);
  if (!account || !await isCommunityModerator(await communityDatabase(), account.accountId)) {
    return { response: communityErrorResponse({ code: account ? "MODERATOR_REQUIRED" : "AUTH_REQUIRED", status: account ? 403 : 401 }) };
  }
  return { account };
}

export async function GET(request: Request) {
  try {
    const result = await moderator(request);
    if ("response" in result) return result.response;
    const reports = await listOpenCommunityReports(await communityDatabase());
    return Response.json({ reports }, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const result = await moderator(request);
    if ("response" in result) return result.response;
    const body = await jsonObject(request);
    const moderated = await moderateCommunityContent(await communityDatabase(), result.account.accountId, body);
    return Response.json(moderated, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return communityErrorResponse(error); }
}
