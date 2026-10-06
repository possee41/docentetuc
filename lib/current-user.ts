import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { getAuthenticatedAccount } from "@/lib/auth-session";
import { deviceUser } from "@/lib/device-user";
import { validInstallationId } from "@/lib/identity-link";

export async function currentUser(request: Request) {
  const deviceId = request.headers.get("x-docentetuc-device") || "";
  const installation = validInstallationId(deviceId) ? deviceUser(deviceId) : null;
  const account = await getAuthenticatedAccount(request);

  if (installation) {
    try {
      const owner = await getD1().prepare("SELECT account_id FROM account_installations WHERE device_id=?").bind(deviceId).first<{ account_id: string }>();
      if (owner) {
        if (!account || owner.account_id !== account.accountId) throw new Error("UNAUTHENTICATED");
        return { userId: account.accountId, email: "", fullName: "Cuenta DocenteTuc", displayName: "Cuenta DocenteTuc" };
      }
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHENTICATED") throw error;
      if (!(error instanceof Error && /no such table:\s*account_installations/i.test(error.message))) throw new Error("UNAUTHENTICATED");
      // Before migration 0014, legacy device-bound features remain available.
    }
  }

  // A signed-in but unlinked device keeps its independent legacy data until consent.
  if (account && !installation) return { userId: account.accountId, email: "", fullName: "Cuenta DocenteTuc", displayName: "Cuenta DocenteTuc" };
  const user = await getChatGPTUser();
  if (user) return user;
  if (installation) return installation;
  throw new Error("UNAUTHENTICATED");
}

export function authError(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHENTICATED";
}
