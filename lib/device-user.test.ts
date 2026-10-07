import assert from "node:assert/strict";
import test from "node:test";
import { deviceRequestHeaders, deviceUser } from "./device-user.ts";

test("la API no inventa un ID cliente antes de que el servidor cree la instalación", () => {
  assert.deepEqual(deviceRequestHeaders(null), {});
  assert.deepEqual(deviceRequestHeaders(null, true), { "Content-Type": "application/json" });
  assert.deepEqual(deviceRequestHeaders("550e8400-e29b-41d4-a716-446655440001"), {
    "X-DocenteTuc-Device": "550e8400-e29b-41d4-a716-446655440001",
  });
});

test("una instalación no vinculada tiene identidad local sin exigir sesión Google", () => {
  const id = "550e8400-e29b-41d4-a716-446655440001";
  assert.deepEqual(deviceUser(id), { userId: `device:${id}`, email: "", fullName: "Docente", displayName: "Docente" });
  assert.equal(deviceUser("not-an-installation"), null);
});
