import assert from "node:assert/strict";
import test from "node:test";
import { classifySourceError, SourceSyncError, sourceErrorCode } from "./publication-lifecycle.ts";
import { fetchSourceJson } from "./source-fetch.ts";

const request = (fetcher: typeof fetch) => fetchSourceJson<unknown>("https://sime.educaciontuc.gov.ar/public-endpoint", { source: "SIME", fetcher });

test("clasifica DNS, timeout, conexión y errores HTTP sin llamarlos parsing", async () => {
  assert.equal(classifySourceError(new Error("getaddrinfo ENOTFOUND sime.educaciontuc.gov.ar")), "DNS_ERROR");
  assert.equal(classifySourceError(new Error("HttpRequestException: Host desconocido. (sime.educaciontuc.gov.ar:443)")), "DNS_ERROR");
  assert.equal(classifySourceError(new Error("AbortError: request timed out")), "TIMEOUT");
  assert.equal(classifySourceError(new Error("connect ECONNREFUSED")), "NETWORK_ERROR");
  for (const [status, expectedCode] of [[404, "HTTP_404"], [503, "HTTP_503"]] as const) {
    await assert.rejects(request(async () => new Response("error", { status })), (error: unknown) => {
      assert.equal(classifySourceError(error), "HTTP_ERROR");
      assert.equal(sourceErrorCode(error), expectedCode);
      return true;
    });
  }
});

test("distingue redirect, HTML, respuesta vacía, JSON inválido y JSON válido vacío", async () => {
  const redirected = new Response("{}", { headers: { "content-type": "application/json" } });
  Object.defineProperty(redirected, "redirected", { value: true });
  await assert.rejects(request(async () => redirected), (error: unknown) => classifySourceError(error) === "REDIRECT_ERROR");
  await assert.rejects(request(async () => new Response("<html>login</html>", { headers: { "content-type": "text/html" } })), (error: unknown) => classifySourceError(error) === "HTML_RESPONSE");
  await assert.rejects(request(async () => new Response("", { headers: { "content-type": "application/json" } })), (error: unknown) => classifySourceError(error) === "EMPTY_RESPONSE");
  await assert.rejects(request(async () => new Response("{", { headers: { "content-type": "application/json" } })), (error: unknown) => classifySourceError(error) === "PARSE_ERROR");
  assert.deepEqual(await request(async () => new Response("[]", { headers: { "content-type": "application/json" } })), []);
});

test("la estructura JSON inválida tiene código de esquema y los errores desconocidos no se etiquetan como parseo", () => {
  assert.equal(classifySourceError(new SourceSyncError("SCHEMA_ERROR", "SIME schema mismatch")), "SCHEMA_ERROR");
  assert.equal(classifySourceError(new Error("unclassified failure")), "UNKNOWN");
  assert.equal(classifySourceError(new Error("internal error; reference = 12345")), "UNKNOWN");
});
