import { deviceUser } from "./device-user.ts";
import { installationProofFor } from "./installation-ownership.ts";
import { validInstallationId } from "./identity-link.ts";

type Database = {
  prepare(sql: string): { bind(...values: string[]): { first<T>(): Promise<T | null> } };
};

type CurrentUser = { userId: string; email: string; fullName: string | null; displayName: string };
type Account = { accountId: string };

export async function resolveCurrentUser(
  request: Request,
  dependencies: {
    getDatabase: () => Database;
    getAccount: (request: Request) => Promise<Account | null>;
    getFallbackUser: () => Promise<CurrentUser | null>;
  },
) {
  const deviceId = request.headers.get("x-docentetuc-device") || "";
  const installation = validInstallationId(deviceId) ? deviceUser(deviceId) : null;
  const account = await dependencies.getAccount(request);

  if (installation) {
    try {
      const db = dependencies.getDatabase();
      const proof = await installationProofFor(db, request, deviceId).catch((error) => {
        if (error instanceof Error && /no such table:\s*installation_credentials/i.test(error.message)) return "missing" as const;
        throw error;
      });
      const owner = await db.prepare("SELECT account_id FROM account_installations WHERE device_id=?").bind(deviceId).first<{ account_id: string }>();
      if (owner) {
        if (!account || owner.account_id !== account.accountId) throw new Error("UNAUTHENTICATED");
        return { userId: account.accountId, email: "", fullName: "Cuenta DocenteTuc", displayName: "Cuenta DocenteTuc" };
      }
      if (proof === "invalid") {
        if (account) return { userId: account.accountId, email: "", fullName: "Cuenta DocenteTuc", displayName: "Cuenta DocenteTuc" };
        throw new Error("UNAUTHENTICATED");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "UNAUTHENTICATED") throw error;
      if (!(error instanceof Error && /no such table:\s*account_installations/i.test(error.message))) throw new Error("UNAUTHENTICATED");
      // Before migration 0014, legacy device-bound features remain available.
    }
  }

  // A signed-in but unlinked device keeps its independent legacy data until consent.
  if (account && !installation) return { userId: account.accountId, email: "", fullName: "Cuenta DocenteTuc", displayName: "Cuenta DocenteTuc" };
  const user = await dependencies.getFallbackUser();
  if (user) return user;
  if (installation) return installation;
  throw new Error("UNAUTHENTICATED");
}
