import { getAuthenticatedAccount } from "./auth-session.ts";
import { requireCommunityAdmin } from "./community-admin.ts";
import { CommunityError } from "./community.ts";
import { communityDatabase } from "./community-route.ts";

export async function authorizedAdmin(request: Request) {
  const account = await getAuthenticatedAccount(request);
  if (!account) throw new CommunityError("AUTH_REQUIRED", 401);
  const database = await communityDatabase();
  await requireCommunityAdmin(database, account.accountId);
  return { account, database };
}

export const adminResponseHeaders = { "Cache-Control": "no-store, private", Vary: "Cookie" };
