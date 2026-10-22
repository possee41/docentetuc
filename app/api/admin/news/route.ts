import { authorizedAdmin, adminResponseHeaders } from "@/lib/admin-route";
import { isSameOriginMutation } from "@/lib/auth-identity";
import { communityErrorResponse } from "@/lib/community";
import { jsonObject } from "@/lib/community-route";
import { listNewsAdmin, mutateNewsAdmin, newsAdminDetail, searchNewsOrigins } from "@/lib/news-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { database } = await authorizedAdmin(request);
    const params = new URL(request.url).searchParams;
    const result = params.has("id") ? await newsAdminDetail(database, params.get("id") || "")
      : params.has("publicationQuery") ? await searchNewsOrigins(database, params.get("publicationQuery") || "")
      : await listNewsAdmin(database, params);
    return Response.json(result, { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403, headers: adminResponseHeaders });
  try {
    const body = await jsonObject(request);
    const { account, database } = await authorizedAdmin(request);
    return Response.json(await mutateNewsAdmin(database, account.accountId, body), { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}
