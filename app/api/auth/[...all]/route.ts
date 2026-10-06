import { getDocenteTucAuth } from "@/lib/auth";

async function handle(request: Request) {
  const auth = await getDocenteTucAuth();
  if (!auth) {
    return Response.json(
      { error: "AUTH_NOT_CONFIGURED", message: "El inicio de sesión todavía no está configurado." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return auth.handler(request);
}

export const GET = handle;
export const POST = handle;
