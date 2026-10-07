import { getChatGPTUser } from "@/app/chatgpt-auth";
import { getD1 } from "@/db";
import { getAuthenticatedAccount } from "@/lib/auth-session";
import { resolveCurrentUser } from "@/lib/current-user-resolver";

export async function currentUser(request: Request) {
  return resolveCurrentUser(request, {
    getDatabase: getD1,
    getAccount: getAuthenticatedAccount,
    getFallbackUser: getChatGPTUser,
  });
}

export function authError(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHENTICATED";
}
