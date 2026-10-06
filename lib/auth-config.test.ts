import assert from "node:assert/strict";
import test from "node:test";
import { readAuthConfiguration } from "./auth-config.ts";

const complete = {
  BETTER_AUTH_SECRET: "a-secure-test-secret-that-is-long-enough-for-auth",
  BETTER_AUTH_URL: "https://docentetuc.example.com",
  GOOGLE_CLIENT_ID: "public-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-only-oauth-client-secret",
};

test("no considera configurada la autenticación sin secretos/credenciales", () => {
  const result = readAuthConfiguration({}, "production");
  assert.equal(result.configured, false);
  if (!result.configured) assert.deepEqual(result.missing, ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"]);
});

test("acepta HTTPS y limita cookies seguras al origen configurado", () => {
  const result = readAuthConfiguration(complete, "production");
  assert.equal(result.configured, true);
  if (result.configured) {
    assert.equal(result.value.baseURL, "https://docentetuc.example.com");
    assert.equal(result.value.origin, "https://docentetuc.example.com");
    assert.equal(result.value.secureCookies, true);
  }
});

test("permite HTTP solamente en localhost de desarrollo", () => {
  const result = readAuthConfiguration({ ...complete, BETTER_AUTH_URL: "http://localhost:5173" }, "development");
  assert.equal(result.configured, true);
  assert.equal(readAuthConfiguration({ ...complete, BETTER_AUTH_URL: "http://docentetuc.example.com" }, "development").configured, false);
  assert.equal(readAuthConfiguration({ ...complete, BETTER_AUTH_URL: "http://localhost:5173" }, "production").configured, false);
});

test("rechaza hosts compartidos de Cloudflare para producción OAuth", () => {
  assert.equal(readAuthConfiguration({ ...complete, BETTER_AUTH_URL: "https://docentetuc.workers.dev" }, "production").configured, false);
  assert.equal(readAuthConfiguration({ ...complete, BETTER_AUTH_URL: "https://docentetuc.pages.dev" }, "production").configured, false);
});

test("rechaza secretos cortos y base URLs con rutas", () => {
  assert.equal(readAuthConfiguration({ ...complete, BETTER_AUTH_SECRET: "too-short" }, "production").configured, false);
  assert.equal(readAuthConfiguration({ ...complete, BETTER_AUTH_URL: "https://docentetuc.example.com/login" }, "production").configured, false);
});
