import { getD1 } from "@/db";
import { hasAccountIdentitySchema } from "@/lib/auth-schema";
import { getAuthenticatedAccount } from "@/lib/auth-session";
import { InstallationLinkError, installationDataPreview, linkInstallationData, validInstallationId, type IdentityDatabase } from "@/lib/identity-link";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

function responseForLinkError(error: unknown) {
  if (error instanceof InstallationLinkError) {
    if (error.code === "NO_INSTALLATION") return Response.json({ error: "No se pudo identificar esta instalación." }, { status: 400 });
    if (error.code === "CONSENT_REQUIRED") return Response.json({ error: "Confirmá explícitamente la vinculación." }, { status: 400 });
    return Response.json({ error: "Esta instalación ya está vinculada a otra cuenta. No se modificó ningún dato." }, { status: 409 });
  }
  return Response.json({ error: "No se pudo comprobar la vinculación." }, { status: 500 });
}

async function context(request: Request) {
  const account = await getAuthenticatedAccount(request);
  if (!account) return { response: Response.json({ error: "Iniciá sesión para continuar." }, { status: 401 }) };
  const deviceId = request.headers.get("x-docentetuc-device") || "";
  if (!validInstallationId(deviceId)) return { response: Response.json({ error: "No se pudo identificar esta instalación." }, { status: 400 }) };
  const db = getD1();
  if (!await hasAccountIdentitySchema(db)) return { response: Response.json({ error: "La vinculación todavía no está habilitada en esta base local." }, { status: 503 }) };
  return { account, deviceId, db: db as unknown as IdentityDatabase };
}

export async function GET(request: Request) {
  try {
    const result = await context(request);
    if ("response" in result) return result.response;
    const preview = await installationDataPreview(result.db, result.account.accountId, result.deviceId);
    return Response.json(preview, { headers: { "Cache-Control": "no-store, private", Vary: "Cookie" } });
  } catch (error) { return responseForLinkError(error); }
}

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const result = await context(request);
    if ("response" in result) return result.response;
    const body = await request.json().catch(() => null) as { consent?: unknown } | null;
    if (body?.consent !== true) throw new InstallationLinkError("CONSENT_REQUIRED");
    const linked = await linkInstallationData(result.db, result.account.accountId, result.deviceId, true);
    return Response.json(linked, { headers: { "Cache-Control": "no-store, private" } });
  } catch (error) { return responseForLinkError(error); }
}
