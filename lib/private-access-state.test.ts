import assert from "node:assert/strict";
import test from "node:test";
import { privateAccessState } from "./private-access-state.ts";

test("inicialización: no anunciar recuperación ni rechazo con sesión pendiente", () => {
  assert.equal(privateAccessState(false,"unavailable","checking"),"checking");
  assert.equal(privateAccessState(false,"recovery_required","unauthorized"),"checking");
  assert.equal(privateAccessState(true,"recovery_required","checking"),"checking");
});
test("una cuenta autorizada por la API conserva acceso aunque falte la prueba de instalación", () => {
  assert.equal(privateAccessState(true,"recovery_required","ready"),"ready");
  assert.equal(privateAccessState(true,"linked","ready"),"ready");
  assert.equal(privateAccessState(false,"unavailable","ready"),"ready");
});
test("recuperación legítima: credencial sin prueba y acceso privado rechazado", () => {
  assert.equal(privateAccessState(true,"recovery_required","unauthorized"),"recovery_required");
  assert.equal(privateAccessState(true,"linked","unauthorized"),"unauthorized");
});
test("fallos de red o servicio no demuestran que se necesite recuperar identidad", () => {
  assert.equal(privateAccessState(true,"recovery_required","error"),"error");
  assert.equal(privateAccessState(true,"unavailable","unauthorized"),"error");
  assert.equal(privateAccessState(true,"protected","error"),"error");
});
test("secuencia reproducida: 409 de credencial, espera de cuenta, 200 autorizado; sin recuperación intermedia", () => {
  const states = [privateAccessState(false,"unavailable","checking"),privateAccessState(true,"recovery_required","checking"),privateAccessState(true,"recovery_required","ready")];
  assert.deepEqual(states,["checking","checking","ready"]);
  assert.equal(privateAccessState(true,"recovery_required","checking"),"checking");
  assert.equal(privateAccessState(true,"recovery_required","unauthorized"),"recovery_required");
});
