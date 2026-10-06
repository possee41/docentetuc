import assert from "node:assert/strict";
import test from "node:test";
import { accountFromValidatedSession, accountOwnsResource, authenticatedAccountFromRequest, authorizeAccountResource, isSameOriginMutation, publicAuthStatus, safeGoogleAccountName, safeGoogleProfileImage } from "./auth-identity.ts";
import { deviceUser } from "./device-user.ts";

const USER_A = "550e8400-e29b-41d4-a716-446655440000";
const USER_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";

test("un UUID de dispositivo por sí solo no autentica", async () => {
  const request = new Request("https://docentetuc.example.com/api/social", {
    headers: { "X-DocenteTuc-Device": USER_A },
  });
  assert.equal(deviceUser(USER_A)?.userId, `device:${USER_A}`);
  assert.equal(await authenticatedAccountFromRequest(request, async () => null), null);
});

test("rechaza sesión inexistente, cookie/token inválido y sesión expirada", () => {
  assert.equal(accountFromValidatedSession(null), null);
  assert.equal(accountFromValidatedSession({ user: { id: USER_A }, session: { expiresAt: "invalid" } }), null);
  assert.equal(accountFromValidatedSession({ user: { id: USER_A }, session: { expiresAt: new Date(1_000) } }, 1_000), null);
  assert.equal(accountFromValidatedSession({ user: { id: "attacker-selected-id" }, session: { expiresAt: new Date(Date.now() + 60_000) } }), null);
});

test("reconoce sesión válida solo después de que el lector del servidor la valida", async () => {
  const request = new Request("https://docentetuc.example.com/api/social", {
    headers: { cookie: "docentetuc-auth.session_token=opaque-token" },
  });
  const account = await authenticatedAccountFromRequest(request, async (received) => {
    assert.equal(received.headers.get("cookie"), request.headers.get("cookie"));
    return { user: { id: USER_A }, session: { expiresAt: new Date(Date.now() + 60_000) } };
  });
  assert.deepEqual(account, { accountId: USER_A });
});

test("la identidad A no puede gestionar recursos pertenecientes a B", () => {
  const account = accountFromValidatedSession({ user: { id: USER_A }, session: { expiresAt: new Date(Date.now() + 60_000) } });
  assert.equal(accountOwnsResource(account, USER_A), true);
  assert.equal(accountOwnsResource(account, USER_B), false);
  assert.equal(accountOwnsResource(null, USER_A), false);
});

test("la frontera protegida rechaza anónimos con 401 y cuentas ajenas con 403", async () => {
  const request = new Request("https://docentetuc.example.com/api/future-social");
  assert.deepEqual(await authorizeAccountResource(request, async () => null, USER_A), { authorized: false, status: 401 });
  assert.deepEqual(await authorizeAccountResource(request, async () => ({ user: { id: USER_A }, session: { expiresAt: new Date(Date.now() + 60_000) } }), USER_B), { authorized: false, status: 403 });
});

test("estado público solo incluye nombre/foto de la sesión propia y no email, account id ni perfil privado", () => {
  const status = publicAuthStatus(true, { accountId: USER_A }, "https://lh3.googleusercontent.com/a/example=s96-c", "Docente A");
  assert.deepEqual(status, { configured: true, authenticated: true, image: "https://lh3.googleusercontent.com/a/example=s96-c", name: "Docente A" });
  assert.equal("email" in status, false);
  assert.equal("accountId" in status, false);
  assert.equal("profile" in status, false);
  assert.deepEqual(publicAuthStatus(true, null, "https://lh3.googleusercontent.com/a/example", "No autenticado"), { configured: true, authenticated: false, image: null, name: null });
});

test("la foto de cuenta acepta solo HTTPS de Google y rechaza URLs arbitrarias", () => {
  assert.equal(safeGoogleProfileImage("https://lh3.googleusercontent.com/a/example"), "https://lh3.googleusercontent.com/a/example");
  assert.equal(safeGoogleProfileImage("http://lh3.googleusercontent.com/a/example"), null);
  assert.equal(safeGoogleProfileImage("https://attacker.example/image.png"), null);
  assert.equal(safeGoogleProfileImage("https://googleusercontent.com.attacker.example/image.png"), null);
  assert.equal(safeGoogleProfileImage("javascript:alert(1)"), null);
  assert.equal(safeGoogleProfileImage("x".repeat(2049)), null);
});

test("el nombre mostrado de Google se normaliza y nunca se devuelve sin sesión", () => {
  assert.equal(safeGoogleAccountName("  Docente\n A  "), "Docente A");
  assert.equal(safeGoogleAccountName("\u0000\t"), null);
  assert.equal(safeGoogleAccountName(7), null);
  assert.equal(safeGoogleAccountName("A".repeat(100))?.length, 80);
  assert.equal(publicAuthStatus(true, null, null, "Docente A").name, null);
});

test("las mutaciones autenticadas rechazan orígenes cruzados y requests sin Origin", () => {
  assert.equal(isSameOriginMutation(new Request("http://localhost:5173/api/auth/link", { method: "POST", headers: { origin: "http://localhost:5173" } })), true);
  assert.equal(isSameOriginMutation(new Request("http://localhost:5173/api/auth/link", { method: "POST", headers: { origin: "http://127.0.0.1:5173" } })), false);
  assert.equal(isSameOriginMutation(new Request("http://localhost:5173/api/auth/link", { method: "POST" })), false);
});

test("una sesión revocada por logout deja de resolverse", async () => {
  const request = new Request("https://docentetuc.example.com/api/social", { headers: { cookie: "session=revocable" } });
  let revoked = false;
  const readSession = async () => revoked ? null : ({ user: { id: USER_A }, session: { expiresAt: new Date(Date.now() + 60_000) } });
  assert.deepEqual(await authenticatedAccountFromRequest(request, readSession), { accountId: USER_A });
  revoked = true;
  assert.equal(await authenticatedAccountFromRequest(request, readSession), null);
});
