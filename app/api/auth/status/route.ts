import { getDocenteTucAuth } from "@/lib/auth";
import { accountFromValidatedSession, publicAuthStatus } from "@/lib/auth-identity";
import { getD1 } from "@/db";
import { isCommunityAdmin } from "@/lib/community-admin";

export async function GET(request: Request) {
  const auth = await getDocenteTucAuth();
  const session = auth ? await auth.api.getSession({ headers: request.headers }) : null;
  const account = accountFromValidatedSession(session);
  const isAdmin = account ? await isCommunityAdmin(getD1(), account.accountId) : false;

  return Response.json(
    { ...publicAuthStatus(Boolean(auth), account, session?.user?.image, session?.user?.name), isAdmin },
    { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } },
  );
}
