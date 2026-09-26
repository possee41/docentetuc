import { getChatGPTUser } from "@/app/chatgpt-auth";

export async function currentUser() {
  const user = await getChatGPTUser();
  if (!user && process.env.NODE_ENV !== "production") return { userId: "local-docentetuc", email: "docente@local.test", fullName: "Joaquín", displayName: "Joaquín" };
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export function authError(error: unknown) {
  return error instanceof Error && error.message === "UNAUTHENTICATED";
}
