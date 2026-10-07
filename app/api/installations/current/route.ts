import { getD1 } from "@/db";
import { hasAccountIdentitySchema, hasInstallationCredentialsSchema } from "@/lib/auth-schema";
import { changedRows, installationDataDeletionStatements, installationProofCookies, installationProofFor } from "@/lib/installation-ownership";
import { validInstallationId } from "@/lib/identity-link";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const db = getD1(), deviceId = request.headers.get("x-docentetuc-device") || "";
    if (!validInstallationId(deviceId)) return Response.json({ error: "No se pudo identificar esta instalación." }, { status: 400 });
    if (!await hasInstallationCredentialsSchema(db) || !await hasAccountIdentitySchema(db)) return Response.json({ error: "La eliminación segura de esta instalación todavía no está habilitada." }, { status: 503 });
    if (await installationProofFor(db, request, deviceId) !== "valid") return Response.json({ error: "No se pudo verificar la propiedad de esta instalación. No se borró ningún dato." }, { status: 403 });
    const linked = await db.prepare("SELECT 1 AS linked FROM account_installations WHERE device_id=?").bind(deviceId).first();
    if (linked) return Response.json({ error: "Esta instalación está vinculada a una cuenta. Usá la eliminación de cuenta para borrar sus datos." }, { status: 409 });

    const statements = installationDataDeletionStatements(deviceId);
    const result = await db.batch(statements.map(({ sql, values }) => db.prepare(sql).bind(...values)));
    if (changedRows(result.at(-1)) === 0) return Response.json({ error: "Esta instalación cambió de estado y no se eliminó ningún dato. Reintentá o contactá a soporte." }, { status: 409, headers: { "Cache-Control": "no-store" } });
    const headers = new Headers({ "Cache-Control": "no-store, private" });
    for (const cookie of installationProofCookies(request, "", true)) headers.append("Set-Cookie", cookie);
    return Response.json({ ok: true, installationDataDeleted: true }, { headers });
  } catch {
    return Response.json({ error: "No se pudieron eliminar los datos de esta instalación. Conservá la app e intentá nuevamente." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
