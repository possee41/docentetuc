/** Only these Better Auth endpoints are needed by the Google login flow. */
export async function handleBrowserAuthRequest(request: Request, handler: (request: Request) => Promise<Response>) {
  const path = new URL(request.url).pathname;
  const allowed =
    (request.method === "POST" && (path === "/api/auth/sign-in/social" || path === "/api/auth/sign-out")) ||
    ((request.method === "GET" || request.method === "POST") && path === "/api/auth/callback/google") ||
    (request.method === "GET" && path === "/api/auth/error");
  if (!allowed) return Response.json({ error: "NOT_FOUND" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (path === "/api/auth/sign-in/social") {
    const body = await request.clone().json().catch(() => null) as Record<string, unknown> | null;
    if (!body || typeof body !== "object" || Array.isArray(body) || body.provider !== "google" || "idToken" in body) {
      return Response.json({ error: "INVALID_REQUEST" }, { status: 400, headers: { "Cache-Control": "no-store" } });
    }
  }
  return handler(request);
}
