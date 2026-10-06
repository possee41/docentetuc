import assert from "node:assert/strict";
import test from "node:test";
import { accountFromValidatedSession, accountOwnsResource, authenticatedAccountFromRequest, authorizeAccountResource, isSameOriginMutation, publicAuthStatus } from "./auth-identity.ts";
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

test("estado público no expone email, account id ni perfil privado", () => {
  const status = publicAuthStatus(true, { accountId: USER_A });
  assert.deepEqual(status, { configured: true, authenticated: true });
  assert.equal("email" in status, false);
  assert.equal("accountId" in status, false);
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
