import { env } from "cloudflare:workers";
import { authorizedAdmin, adminResponseHeaders } from "@/lib/admin-route";
import { adminAIStatus, adminDashboard, adminPublications, adminSyncStatus, adminUsers } from "@/lib/admin-data";
import { communityErrorResponse } from "@/lib/community";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { database } = await authorizedAdmin(request);
    const url = new URL(request.url), section = url.searchParams.get("section") || "dashboard";
    const result = section === "dashboard" ? await adminDashboard(database)
      : section === "users" ? await adminUsers(database, url.searchParams.get("q") || "")
      : section === "publications" ? await adminPublications(database, url.searchParams)
      : section === "sync" ? await adminSyncStatus(database)
      : section === "ai" ? await adminAIStatus(database, env as unknown as Record<string, string | undefined>)
      : null;
    if (!result) return Response.json({ error: "Sección desconocida." }, { status: 404, headers: adminResponseHeaders });
    return Response.json(result, { headers: adminResponseHeaders });
  } catch (error) { return communityErrorResponse(error); }
}
