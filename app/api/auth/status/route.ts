import { getDocenteTucAuth } from "@/lib/auth";
import { accountFromValidatedSession, publicAuthStatus } from "@/lib/auth-identity";

export async function GET(request: Request) {
  const auth = await getDocenteTucAuth();
  const session = auth ? await auth.api.getSession({ headers: request.headers }) : null;
  const account = accountFromValidatedSession(session);

  return Response.json(
    publicAuthStatus(Boolean(auth), account, session?.user?.image, session?.user?.name),
    { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } },
  );
}
