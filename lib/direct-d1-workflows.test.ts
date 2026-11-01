import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const secrets = { fdci: "FDCI_IMPORT_SECRET", sime: "SIME_IMPORT_SECRET", juntas: "JUNTAS_IMPORT_SECRET",
  cenet: "CENET_IMPORT_SECRET", infd: "INFD_IMPORT_SECRET" };

test("los cinco importadores siguen manuales y usan únicamente el gateway autenticado", () => {
  const concurrencyGroups = new Set<string>();
  for (const source of Object.keys(secrets)) {
    const workflow = readFileSync(new URL(`../.github/workflows/${source}-import.yml`, import.meta.url), "utf8");
    assert.match(workflow, /workflow_dispatch:/);
    assert.doesNotMatch(workflow, /^\s+schedule:/m);
    assert.match(workflow, /scripts\/import-via-gateway\.mjs/);
    assert.match(workflow, /IMPORT_GATEWAY_ENABLED: 'true'/);
    assert.match(workflow, new RegExp(`SYNC_SOURCE: ${source}`));
    assert.match(workflow, /IMPORT_GATEWAY_ORIGIN: \$\{\{ vars\.IMPORT_GATEWAY_ORIGIN \}\}/);
    assert.match(workflow, new RegExp(`${secrets[source]}: \\$\\{\\{ secrets\\.${secrets[source]} \\}\\}`));
    assert.match(workflow, /github\.ref == 'refs\/heads\/feat\/1\.2-sync-integration'/);
    assert.match(workflow, /git rev-parse HEAD/);
    assert.doesNotMatch(workflow, /D1_IMPORT_TOKEN|DIRECT_D1_WRITE_ENABLED|D1_DATABASE_ID:|FDCI_IMPORT_URL:|SIME_IMPORT_URL:|PUBLIC_IMPORT_URL:/);
    assert.doesNotMatch(workflow, /^\s+needs:/m, "un fallo de otra fuente no debe bloquear este workflow");
    const group = workflow.match(/^\s+group: ([\w-]+)$/m)?.[1];
    assert.ok(group);
    assert.equal(concurrencyGroups.has(group), false, "cada fuente debe tener concurrencia independiente");
    concurrencyGroups.add(group);
  }
  const juntas = readFileSync(new URL("../.github/workflows/juntas-import.yml", import.meta.url), "utf8");
  assert.match(juntas, /JUNTAS_GATEWAY_ALLOWED == 'true'/);
  assert.match(juntas, /JUNTAS_MAX_REQUESTS: '25'/);
  assert.match(juntas, /JUNTAS_MAX_PUBLICATION_WRITES: '20'/);
});
