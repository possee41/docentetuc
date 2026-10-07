import { getAuthenticatedAccount } from "@/lib/auth-session";
import { adminCommunityOverview, adminReportContext, requireCommunityAdmin, reviewCommunityReport } from "@/lib/community-admin";
import { communityErrorResponse, moderateCommunityContent } from "@/lib/community";
import { communityDatabase, jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

async function authorized(request: Request) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return { response: communityErrorResponse({ code: "AUTH_REQUIRED", status: 401 }) };
  const database = await communityDatabase();
  await requireCommunityAdmin(database, account.accountId);
  return { account, database };
}

export async function GET(request: Request) {
  try {
    const result = await authorized(request);
    if ("response" in result) return result.response;
    const reportId = new URL(request.url).searchParams.get("reportId");
    return Response.json(reportId ? await adminReportContext(result.database, reportId) : await adminCommunityOverview(result.database),
      { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const result = await authorized(request);
    if ("response" in result) return result.response;
    const body = await jsonObject(request);
    const response = body.action === "resolve" || body.action === "dismiss"
      ? await reviewCommunityReport(result.database, result.account.accountId, body.reportId, body.action)
      : await moderateCommunityContent(result.database, result.account.accountId, body);
    return Response.json(response, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return communityErrorResponse(error); }
}
