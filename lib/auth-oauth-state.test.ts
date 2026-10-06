import assert from "node:assert/strict";
import test from "node:test";
import { betterAuth } from "better-auth";
import { memoryAdapter } from "better-auth/adapters/memory";

test("OAuth state cookie lives as long as the D1 verification window", async () => {
  const db = { user: [], session: [], account: [], verification: [] };
  const auth = betterAuth({
    database: memoryAdapter(db),
    baseURL: "http://localhost:5173",
    secret: "local-only-auth-test-secret-with-enough-length",
    socialProviders: { google: { clientId: "test-client", clientSecret: "test-secret" } },
    rateLimit: { enabled: false },
    advanced: {
      cookiePrefix: "docentetuc-auth-test",
      useSecureCookies: false,
      cookies: { state: { attributes: { maxAge: 600 } } },
      defaultCookieAttributes: { httpOnly: true, sameSite: "lax" },
    },
  });

  const response = await auth.handler(new Request("http://localhost:5173/api/auth/sign-in/social", {
    method: "POST",
    headers: { origin: "http://localhost:5173", "content-type": "application/json" },
    body: JSON.stringify({ provider: "google", callbackURL: "http://localhost:5173/" }),
  }));

  assert.equal(response.status, 200);
  const stateCookie = response.headers.get("set-cookie");
  assert.match(stateCookie ?? "", /^docentetuc-auth-test\.state=/);
  assert.match(stateCookie ?? "", /(?:^|;\s*)Max-Age=600(?:;|$)/i);
  assert.match(stateCookie ?? "", /(?:^|;\s*)HttpOnly(?:;|$)/i);
  assert.match(stateCookie ?? "", /(?:^|;\s*)SameSite=Lax(?:;|$)/i);
  assert.equal(db.verification.length, 1);
  const verification = db.verification[0] as { expiresAt: Date };
  assert.ok(verification.expiresAt.getTime() - Date.now() <= 600_000);
  assert.ok(verification.expiresAt.getTime() - Date.now() > 590_000);
});
