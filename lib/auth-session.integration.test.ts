import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

test("sesión Better Auth: cookie inválida/expirada rechazada y logout revoca inmediatamente", async () => {
  const db = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    database: memoryAdapter(db),
    baseURL: "http://localhost:5173",
    secret: "local-only-auth-test-secret-with-enough-length",
    emailAndPassword: { enabled: true },
    rateLimit: { enabled: false },
    session: { cookieCache: { enabled: false } },
    advanced: {
      database: { generateId: "uuid" },
      cookiePrefix: "docentetuc-auth-test",
      useSecureCookies: false,
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
  });

  const signup = await auth.handler(new Request("http://localhost:5173/api/auth/sign-up/email", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ email: "auth-test@example.invalid", password: "test-only-password-123", name: "Test User" }),
  }));
  assert.equal(signup.status, 200);

  const setCookie = signup.headers.get("set-cookie");
  assert.ok(setCookie);
  const cookie = setCookie.split(";")[0];
  const sessionHeaders = new Headers({ cookie });
  assert.ok(await auth.api.getSession({ headers: sessionHeaders }));

  assert.equal(await auth.api.getSession({ headers: new Headers({ cookie: "docentetuc-auth-test.session_token=invalid" }) }), null);

  const storedSession = db.session[0] as { expiresAt: Date } | undefined;
  assert.ok(storedSession);
  storedSession.expiresAt = new Date(0);
  assert.equal(await auth.api.getSession({ headers: sessionHeaders }), null);

  const signIn = await auth.handler(new Request("http://localhost:5173/api/auth/sign-in/email", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ email: "auth-test@example.invalid", password: "test-only-password-123" }),
  }));
  assert.equal(signIn.status, 200);
  const signedInCookie = signIn.headers.get("set-cookie")?.split(";")[0];
  assert.ok(signedInCookie);
  const signedInHeaders = new Headers({ cookie: signedInCookie });
  assert.ok(await auth.api.getSession({ headers: signedInHeaders }));
  const logout = await auth.handler(new Request("http://localhost:5173/api/auth/sign-out", {
    method: "POST",
    headers: { origin: "http://localhost:5173", cookie: signedInCookie, "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(logout.status, 200);
  assert.equal(await auth.api.getSession({ headers: signedInHeaders }), null);
});
