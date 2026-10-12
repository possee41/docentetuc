import { authorizedAdmin, adminResponseHeaders } from "@/lib/admin-route";
import { communityErrorResponse } from "@/lib/community";
import { jsonObject } from "@/lib/community-route";
import { isSameOriginMutation } from "@/lib/auth-identity";
import { listPreModerationHistory, listPreModerationQueue, restrictCommunityAuthor, reviewPreModeration } from "@/lib/community-pre-moderation-admin";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { database } = await authorizedAdmin(request);
    const [pending, history] = await Promise.all([listPreModerationQueue(database), listPreModerationHistory(database)]);
    return Response.json({ pending, history }, { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    // Consume at most 12 KiB before a possible 401/403 response; the local Worker
    // otherwise keeps an unread request stream and may restart on the next POST.
    const body = await jsonObject(request);
    const { database, account } = await authorizedAdmin(request);
    const result = body.action === "block"
      ? await restrictCommunityAuthor(database, account.accountId, body)
      : await reviewPreModeration(database, account.accountId, body);
    return Response.json(result, { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}
