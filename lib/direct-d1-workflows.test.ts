import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("los cinco importadores siguen manuales y usan únicamente el ejecutor REST canary", () => {
  for (const source of ["fdci", "sime", "juntas", "cenet", "infd"]) {
    const workflow = readFileSync(new URL(`../.github/workflows/${source}-import.yml`, import.meta.url), "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s+schedule:/m);
    assert.match(workflow, /scripts\/import-direct-d1\.mjs/);
    assert.match(workflow, /DIRECT_D1_WRITE_ENABLED: 'true'/);
    assert.match(workflow, /D1_IMPORT_TOKEN: \$\{\{ secrets\.D1_IMPORT_TOKEN \}\}/);
    assert.match(workflow, /github\.ref == 'refs\/heads\/feat\/1\.2-sync-integration'/);
    assert.match(workflow, /git rev-parse HEAD/);
    assert.doesNotMatch(workflow, /D1_DATABASE_ID:|FDCI_IMPORT_URL:|SIME_IMPORT_URL:|PUBLIC_IMPORT_URL:/);
  }
});
