import { getChatGPTUser } from "@/app/chatgpt-auth";
import { deviceUser } from "@/lib/device-user";

export async function currentUser(request: Request) {
  const user = await getChatGPTUser();
  if (user) return user;
  const anonymous = deviceUser(request.headers.get("x-docentetuc-device") || "");
  if (anonymous) return anonymous;
  throw new Error("UNAUTHENTICATED");
}

export function authError(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHENTICATED";
}
