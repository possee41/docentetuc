import { getD1 } from "@/db";
import { hasInstallationCredentialsSchema } from "@/lib/auth-schema";
import { hashInstallationSecret, createInstallationSecret, installationIdForProof, installationProofCookies, installationProofFor } from "@/lib/installation-ownership";
import { validInstallationId } from "@/lib/identity-link";
import { isSameOriginMutation } from "@/lib/auth-identity";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request)) return Response.json({ error: "Solicitud no válida." }, { status: 403 });
  try {
    const db = getD1(), deviceId = request.headers.get("x-docentetuc-device") || "";
    if (!await hasInstallationCredentialsSchema(db)) return Response.json({ status: "unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });

    if (validInstallationId(deviceId)) {
      const credential = await db.prepare("SELECT secret_hash FROM installation_credentials WHERE device_id=?").bind(deviceId).first<{ secret_hash: string }>();
      if (credential) {
        if (await installationProofFor(db, request, deviceId) !== "valid") return Response.json({ status: "recovery_required" }, { status: 409, headers: { "Cache-Control": "no-store" } });
        const linked = await db.prepare("SELECT 1 AS linked FROM account_installations WHERE device_id=?").bind(deviceId).first();
        return Response.json({ status: linked ? "linked" : "ready", deviceId }, { headers: { "Cache-Control": "no-store, private" } });
      }

      return Response.json({ status: "recovery_required" }, { status: 409, headers: { "Cache-Control": "no-store" } });
    }

    const recoveredDeviceId = await installationIdForProof(db, request);
    if (recoveredDeviceId) {
      if (validInstallationId(deviceId) && recoveredDeviceId !== deviceId) return Response.json({ status: "recovery_required" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      const linked = await db.prepare("SELECT 1 AS linked FROM account_installations WHERE device_id=?").bind(recoveredDeviceId).first();
      return Response.json({ status: linked ? "linked" : "ready", deviceId: recoveredDeviceId }, { headers: { "Cache-Control": "no-store, private" } });
    }

    const newDeviceId = crypto.randomUUID(), secret = createInstallationSecret();
    await db.prepare("INSERT INTO installation_credentials(device_id, secret_hash) VALUES (?, ?)").bind(newDeviceId, await hashInstallationSecret(secret)).run();
    const headers = new Headers({ "Cache-Control": "no-store, private" });
    for (const cookie of installationProofCookies(request, secret)) headers.append("Set-Cookie", cookie);
    return Response.json({ status: "created", deviceId: newDeviceId }, { headers });
  } catch {
    return Response.json({ status: "unavailable", error: "No se pudo proteger esta instalación." }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
