import { getDocenteTucAuth } from "@/lib/auth";
import { handleBrowserAuthRequest } from "@/lib/auth-browser-boundary";

async function handle(request: Request) {
  const auth = await getDocenteTucAuth();
  if (!auth) {
    return Response.json(
      { error: "AUTH_NOT_CONFIGURED", message: "El inicio de sesión todavía no está configurado." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return handleBrowserAuthRequest(request, (allowedRequest) => auth.handler(allowedRequest));
}

export const GET = handle;
export const POST = handle;
