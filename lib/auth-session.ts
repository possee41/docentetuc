import { getDocenteTucAuth } from "@/lib/auth";
import { authenticatedAccountFromRequest } from "@/lib/auth-identity";

/** Authenticated identity for future account-owned/social endpoints. */
export async function getAuthenticatedAccount(request: Request) {
  const auth = await getDocenteTucAuth();
  if (!auth) return null;
  return authenticatedAccountFromRequest(request, async (sessionRequest) =>
    auth.api.getSession({ headers: sessionRequest.headers }),
  );
}
