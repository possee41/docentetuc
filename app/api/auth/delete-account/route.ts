import { getD1 } from "@/db";
import { accountDataDeletionStatements } from "@/lib/account-deletion";
import { isSameOriginMutation } from "@/lib/auth-identity";
import { hasAccountIdentitySchema, hasCommunitySavedPostsSchema, hasCommunitySchema } from "@/lib/auth-schema";
import { getDocenteTucAuth } from "@/lib/auth";
import { getAuthenticatedAccount } from "@/lib/auth-session";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  const account = await getAuthenticatedAccount(request);
  if (!account) return Response.json({ error: "Iniciá sesión para eliminar tu cuenta DocenteTuc." }, { status: 401 });
  const body = await request.json().catch(() => null) as { confirmation?: unknown } | null;
  if (body?.confirmation !== "ELIMINAR") return Response.json({ error: "La confirmación no coincide." }, { status: 400 });

  try {
    const db = getD1();
    if (!await hasAccountIdentitySchema(db)) return Response.json({ error: "La eliminación de cuenta no está habilitada en esta base." }, { status: 503 });
    if (!await hasCommunitySchema(db)) return Response.json({ error: "La eliminación de cuenta espera que el esquema social esté instalado en esta base." }, { status: 503 });
    if (!await hasCommunitySavedPostsSchema(db)) return Response.json({ error: "La eliminación de cuenta espera que el esquema de publicaciones guardadas esté instalado en esta base." }, { status: 503 });
    const statements = accountDataDeletionStatements(account.accountId);
    await db.batch(statements.map(({ sql, values }) => db.prepare(sql).bind(...values)));

    // Deleting the D1 identity revokes the session; Better Auth clears its HttpOnly cookie.
    const auth = await getDocenteTucAuth();
    const signOut = auth ? await auth.handler(new Request(new URL("/api/auth/sign-out", request.url), {
      method: "POST",
      headers: request.headers,
      body: "{}",
    })) : null;
    const headers = new Headers({ "Cache-Control": "no-store, private" });
    const expiredCookie = signOut?.headers.get("set-cookie");
    if (expiredCookie) headers.append("Set-Cookie", expiredCookie);
    return Response.json({ ok: true }, { headers });
  } catch {
    return Response.json({ error: "No se pudo eliminar la cuenta. No se informó una eliminación exitosa." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
