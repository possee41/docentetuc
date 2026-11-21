import { getD1 } from "@/db";
import { accountDataDeletionStatements, LAST_ADMIN_MESSAGE, protectLastAdminDeletion } from "@/lib/account-deletion";
import { isSameOriginMutation } from "@/lib/auth-identity";
import { hasAccountIdentitySchema, hasCommunitySavedPostsSchema, hasCommunitySchema, hasInstallationCredentialsSchema } from "@/lib/auth-schema";
import { getDocenteTucAuth } from "@/lib/auth";
import { getAuthenticatedAccount } from "@/lib/auth-session";
import { changedRows, installationDataDeletionStatements, installationProofCookies, installationProofFor } from "@/lib/installation-ownership";
import { validInstallationId } from "@/lib/identity-link";

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
    const deviceId = request.headers.get("x-docentetuc-device") || "";
    const linked = validInstallationId(deviceId)
      ? await db.prepare("SELECT account_id FROM account_installations WHERE device_id=?").bind(deviceId).first<{ account_id: string }>()
      : null;
    const currentInstallationLinkedToAccount = linked?.account_id === account.accountId;
    const hasCredentialSchema = await hasInstallationCredentialsSchema(db);
    const currentInstallationProven = !linked && validInstallationId(deviceId) && hasCredentialSchema
      && await installationProofFor(db, request, deviceId) === "valid";
    const preserveInstallationData = validInstallationId(deviceId) && !linked && !currentInstallationProven;
    let installationDataDeleted = currentInstallationLinkedToAccount;
    const statements = accountDataDeletionStatements(account.accountId);
    const installationStatements = currentInstallationProven ? installationDataDeletionStatements(deviceId) : [];
    if (installationStatements.length) statements.unshift(...installationStatements);
    if (currentInstallationLinkedToAccount && validInstallationId(deviceId) && hasCredentialSchema) statements.splice(statements.length - 1, 0, { sql: "DELETE FROM installation_credentials WHERE device_id=?", values: [deviceId] });
    const batchResults = await db.batch(protectLastAdminDeletion(account.accountId, statements).map(({ sql, values }) => db.prepare(sql).bind(...values)));
    if (changedRows(batchResults.at(-1)) !== 1) return Response.json({ error: LAST_ADMIN_MESSAGE, code: "LAST_ADMIN_REQUIRED" }, { status: 409, headers: { "Cache-Control": "no-store, private" } });
    if (installationStatements.length) installationDataDeleted = changedRows(batchResults[installationStatements.length - 1]) > 0;

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
    if (installationDataDeleted) for (const cookie of installationProofCookies(request, "", true)) headers.append("Set-Cookie", cookie);
    return Response.json({ ok: true, installationDataDeleted, preserveInstallationData }, { headers });
  } catch {
    return Response.json({ error: "No se pudo eliminar la cuenta. No se informó una eliminación exitosa." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
