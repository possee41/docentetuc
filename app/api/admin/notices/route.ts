import { authorizedAdmin, adminResponseHeaders } from "@/lib/admin-route";
import { isSameOriginMutation } from "@/lib/auth-identity";
import { communityErrorResponse } from "@/lib/community";
import { jsonObject } from "@/lib/community-route";
import { listAdminNotices, saveAdminNotice } from "@/lib/admin-notices";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { database } = await authorizedAdmin(request);
    return Response.json(await listAdminNotices(database), { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    // Consume the bounded body before a possible 401/403 response.
    const input = await jsonObject(request);
    const { account, database } = await authorizedAdmin(request);
    if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403, headers: adminResponseHeaders });
    return Response.json(await saveAdminNotice(database, account.accountId, input), { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}
