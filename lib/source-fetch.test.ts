import assert from "node:assert/strict";
import test from "node:test";
import { assessSourceSync, classifySourceError, missingAfterValidatedSync, SourceSyncError, sourceErrorCode } from "./publication-lifecycle.ts";
import { collectSourcePages, fetchSourceJson, sourcePageDiagnostics } from "./source-fetch.ts";

const request = (fetcher: typeof fetch) => fetchSourceJson<unknown>("https://sime.educaciontuc.gov.ar/public-endpoint", { source: "SIME", fetcher });

test("INFoD parcial conserva los registros previos, diagnostica cada 503 y se recupera en otra ejecución sin retry agresivo", async () => {
  const urls = Array.from({ length: 9 }, (_, i) => `https://red.infd.edu.ar/synthetic-${i}/`);
  const previous = urls.map((_, i) => `synthetic-course-${i}`);
  let calls = 0;
  const partial = await collectSourcePages(urls, async url => {
    calls++;
    const i = urls.indexOf(url);
    if (i < 4) throw new SourceSyncError("HTTP_ERROR", "HTTP 503", "HTTP_503");
    return [previous[i]];
  });
  assert.equal(calls, 9);
  assert.equal(partial.complete, false);
  assert.equal(partial.allFailed, false);
  assert.equal(partial.items.length, 5);
  assert.equal(partial.diagnostics.filter(page => page.errorCode === "HTTP_503").length, 4);
  const status = assessSourceSync({ previousCount: 9, recordsFound: partial.items.length, complete: partial.complete });
  assert.equal(status, "PARTIAL");
  assert.deepEqual(missingAfterValidatedSync(previous, partial.items, status), []);
  const recovered = await collectSourcePages(urls, async url => [previous[urls.indexOf(url)]]);
  assert.equal(recovered.complete, true);
  assert.equal(recovered.items.length, 9);
  assert.equal(new Set(recovered.items).size, 9);
  assert.equal(assessSourceSync({ previousCount: 9, recordsFound: 9, complete: recovered.complete }), "OK");
});

test("ninguna página INFoD utilizable no se confunde con una sincronización exitosa vacía", async () => {
  const failed = await collectSourcePages(["https://red.infd.edu.ar/synthetic/"], async () => { throw new SourceSyncError("HTTP_ERROR", "HTTP 503", "HTTP_503"); });
  assert.equal(failed.allFailed, true);
  assert.equal(failed.complete, false);
  assert.equal(failed.items.length, 0);
  assert.equal(failed.diagnostics[0].status, "HTTP_ERROR");
});

test("el diagnóstico de páginas conserva cada causa y cantidad sin volcar datos ni secretos", () => {
  const results: PromiseSettledResult<string[]>[] = [
    { status: "fulfilled", value: ["contenido no se registra"] },
    { status: "rejected", reason: new SourceSyncError("HTTP_ERROR", "https://red.infd.edu.ar/error/?token=NO_REGISTRAR", "HTTP_503") },
    { status: "rejected", reason: new DOMException("NO_REGISTRAR", "TimeoutError") },
    { status: "fulfilled", value: [] },
  ];
  const rows = sourcePageDiagnostics(["/ok/", "/error/", "/timeout/", "/empty/"].map((path) => `https://red.infd.edu.ar${path}?token=NO_REGISTRAR`), results);
  assert.deepEqual(rows.map(({ records, status, errorCode }) => ({ records, status, errorCode })), [
    { records: 1, status: "OK", errorCode: null }, { records: 0, status: "HTTP_ERROR", errorCode: "HTTP_503" },
    { records: 0, status: "TIMEOUT", errorCode: "TIMEOUT" }, { records: 0, status: "OK", errorCode: null },
  ]);
  assert.doesNotMatch(JSON.stringify(rows), /NO_REGISTRAR|contenido|token=/);
});

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
