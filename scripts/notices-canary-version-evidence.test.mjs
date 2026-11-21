import assert from "node:assert/strict";
import test from "node:test";
import { evaluateAuthVersionEvidence } from "./notices-canary-version-evidence.mjs";

const enabledVersion = "b4a58cb3-04ae-467e-a191-4073b299f23a";
const validTailEvent = {
  scriptVersion: { id: enabledVersion },
  event: { response: { status: 401 } },
  outcome: "ok",
};

test("logs no disponibles no bloquean si las comprobaciones obligatorias pasaron", () => {
  assert.deepEqual(evaluateAuthVersionEvidence({
    mandatoryChecksPassed: true,
    tailEvent: null,
    enabledVersion,
  }), { effectiveVersionVerified: false, reason: "LOGS_UNAVAILABLE" });
});

test("logs válidos confirman la versión", () => {
  assert.deepEqual(evaluateAuthVersionEvidence({
    mandatoryChecksPassed: true,
    tailEvent: validTailEvent,
    enabledVersion,
  }), { effectiveVersionVerified: true, reason: null });
});

test("falta una comprobación obligatoria se detiene aunque existan logs", () => {
  assert.throws(() => evaluateAuthVersionEvidence({
    mandatoryChecksPassed: false,
    tailEvent: validTailEvent,
    enabledVersion,
  }), /MANDATORY_CHECKS_INCOMPLETE/);
});

test("versión incorrecta en logs se detiene", () => {
  assert.throws(() => evaluateAuthVersionEvidence({
    mandatoryChecksPassed: true,
    tailEvent: { ...validTailEvent, scriptVersion: { id: "otra-version" } },
    enabledVersion,
  }), /HTTP_ACTIVE_VERSION_MISMATCH/);
});

test("estado HTTP inesperado en logs se detiene", () => {
  assert.throws(() => evaluateAuthVersionEvidence({
    mandatoryChecksPassed: true,
    tailEvent: { ...validTailEvent, event: { response: { status: 200 } } },
    enabledVersion,
  }), /UNEXPECTED_HTTP_STATUS/);
});

test("outcome no ok en logs se detiene", () => {
  assert.throws(() => evaluateAuthVersionEvidence({
    mandatoryChecksPassed: true,
    tailEvent: { ...validTailEvent, outcome: "exceededCpu" },
    enabledVersion,
  }), /UNEXPECTED_OUTCOME/);
});
