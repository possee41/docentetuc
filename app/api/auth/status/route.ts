import { getDocenteTucAuth } from "@/lib/auth";
import { authenticatedAccountFromRequest, publicAuthStatus } from "@/lib/auth-identity";

export async function GET(request: Request) {
  const auth = await getDocenteTucAuth();
  const account = auth
    ? await authenticatedAccountFromRequest(request, async (sessionRequest) =>
      auth.api.getSession({ headers: sessionRequest.headers }),
    )
    : null;

  return Response.json(
    publicAuthStatus(Boolean(auth), account),
    { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } },
  );
}
