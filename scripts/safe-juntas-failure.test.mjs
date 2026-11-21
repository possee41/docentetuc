import assert from "node:assert/strict";
import { test } from "node:test";
import { safeJuntasFailures } from "./safe-juntas-failure.mjs";

test("partial Juntas diagnostics retain technical identifiers without leaking URLs or keys", () => {
  assert.deepEqual(safeJuntasFailures([
    { category: "Comunicados", code: "DRIVE_HTTP_429", rootId: "drive_root_1", id: "padrones:file_1", bodyBytes: 101000 },
    { category: "other", code: "https://example.invalid/?key=secret", rootId: "secret?key=123" },
  ]), [
    { category: "Comunicados", code: "DRIVE_HTTP_429", rootId: "drive_root_1", id: "padrones:file_1", bodyBytes: 101000, summaryBytes: undefined, metadataBytes: undefined },
    { category: "Desconocida", code: "SOURCE_ERROR", rootId: undefined, id: undefined, bodyBytes: undefined, summaryBytes: undefined, metadataBytes: undefined },
  ]);
});
