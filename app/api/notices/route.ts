import { getD1 } from "@/db";
import { activeAdminNotices } from "@/lib/admin-notices";
import type { CommunityDatabase } from "@/lib/community";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    // Public, time-limited editorial notices only. Never includes admin actor IDs or audit rows.
    const notices = await activeAdminNotices(getD1() as unknown as CommunityDatabase);
    return Response.json(notices, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // Allows code to remain compatible until the additive migration is deployed.
    return Response.json([], { headers: { "Cache-Control": "no-store" } });
  }
}
