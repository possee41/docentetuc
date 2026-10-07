import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";
import { handleBrowserAuthRequest } from "./auth-browser-boundary.ts";
import { accountFromValidatedSession, publicAuthStatus } from "./auth-identity.ts";

test("sesión Better Auth: cookie inválida/expirada rechazada y logout revoca inmediatamente", async () => {
  const db = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    database: memoryAdapter(db),
    baseURL: "http://localhost:5173",
    secret: "local-only-auth-test-secret-with-enough-length",
    emailAndPassword: { enabled: true },
    socialProviders: { google: { clientId: "local-test-client", clientSecret: "local-test-secret" } },
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
  const sessionA = await auth.api.getSession({ headers: sessionHeaders });
  assert.ok(sessionA);
  const statusA = publicAuthStatus(true, accountFromValidatedSession(sessionA), sessionA.user.image, sessionA.user.name);
  assert.equal(statusA.authenticated, true);
  assert.equal(statusA.name, "Test User");
  const privateSessionToken = (db.session[0] as { token: string }).token;
  assert.ok(privateSessionToken);
  assert.equal(JSON.stringify(statusA).includes(privateSessionToken), false);
  assert.equal(/token|email|accountId|providerAccountId/i.test(JSON.stringify(statusA)), false);

  const otherSignup = await auth.handler(new Request("http://localhost:5173/api/auth/sign-up/email", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ email: "second-auth-test@example.invalid", password: "test-only-password-456", name: "Other Test User" }),
  }));
  assert.equal(otherSignup.status, 200);
  const otherCookie = otherSignup.headers.get("set-cookie")?.split(";")[0];
  assert.ok(otherCookie);
  const sessionB = await auth.api.getSession({ headers: new Headers({ cookie: otherCookie }) });
  assert.ok(sessionB);
  assert.notEqual(sessionA.user.id, sessionB.user.id);
  assert.equal((await auth.api.getSession({ headers: sessionHeaders }))?.user.id, sessionA.user.id);
  assert.notEqual(statusA.name, publicAuthStatus(true, accountFromValidatedSession(sessionB), sessionB.user.image, sessionB.user.name).name);

  for (const path of ["get-session", "list-sessions", "get-access-token", "sign-up/email"]) {
    const response = await handleBrowserAuthRequest(new Request(`http://localhost:5173/api/auth/${path}`, { headers: { cookie } }), (request) => auth.handler(request));
    assert.equal(response.status, 404, `${path} must not expose Better Auth's raw session/account JSON`);
    const body = await response.text();
    assert.equal(body.includes(privateSessionToken), false);
    assert.equal(/accessToken|refreshToken|providerAccountId/i.test(body), false);
  }
  assert.equal((await handleBrowserAuthRequest(new Request("http://localhost:5173/api/auth/get-session", {
    method: "POST", headers: { cookie, origin: "http://localhost:5173" },
  }), (request) => auth.handler(request))).status, 404);
  for (const [method, path] of [["POST", "sign-in/social"], ["GET", "callback/google"], ["POST", "callback/google"], ["POST", "sign-out"], ["GET", "error"]]) {
    const response = await handleBrowserAuthRequest(new Request(`http://localhost:5173/api/auth/${path}`, {
      method,
      ...(path === "sign-in/social" ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:5173/" }) } : {}),
    }), async () => Response.json({ forwarded: true }));
    assert.equal(response.status, 200, `${method} ${path} remains available`);
  }
  for (const body of [{ provider: "google", idToken: { token: "synthetic" } }, { provider: "other" }]) {
    const response = await handleBrowserAuthRequest(new Request("http://localhost:5173/api/auth/sign-in/social", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }), (request) => auth.handler(request));
    assert.equal(response.status, 400, "the direct idToken branch must not return a session token in JSON");
  }
  const oauthStart = await handleBrowserAuthRequest(new Request("http://localhost:5173/api/auth/sign-in/social", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:5173/" }),
  }), (request) => auth.handler(request));
  assert.equal(oauthStart.status, 200);
  const oauthBody = await oauthStart.json() as Record<string, unknown>;
  assert.equal(typeof oauthBody.url, "string");
  assert.equal(new URL(oauthBody.url as string).hostname, "accounts.google.com");
  assert.equal("token" in oauthBody, false);
  assert.equal("accessToken" in oauthBody, false);
  assert.equal("refreshToken" in oauthBody, false);
  assert.match(oauthStart.headers.get("set-cookie") || "", /HttpOnly/i);

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
  const logout = await handleBrowserAuthRequest(new Request("http://localhost:5173/api/auth/sign-out", {
    method: "POST",
    headers: { origin: "http://localhost:5173", cookie: signedInCookie, "content-type": "application/json" },
    body: "{}",
  }), (request) => auth.handler(request));
  assert.equal(logout.status, 200);
  assert.equal(/token|accessToken|refreshToken/i.test(JSON.stringify(await logout.json())), false);
  assert.equal(await auth.api.getSession({ headers: signedInHeaders }), null);
});
