import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workflows = ["fdci", "sime", "juntas", "cenet", "infd"];

test("los cinco importadores siguen manuales y sin calendario activo", () => {
  for (const source of workflows) {
    const yaml = readFileSync(new URL(`../.github/workflows/${source}-import.yml`, import.meta.url), "utf8");
    assert.match(yaml, /^  workflow_dispatch:/m, source);
    assert.doesNotMatch(yaml, /^\s+schedule:/m, source);
    assert.match(yaml, /contents: read/, source);
    assert.match(yaml, /cancel-in-progress: false/, source);
  }
});

test("FDCI deja preparada la programación acotada sin activarla", () => {
  const yaml = readFileSync(new URL("../.github/workflows/fdci-import.yml", import.meta.url), "utf8");
  assert.match(yaml, /# schedule: \[\{ cron: '17 \*\/2 \* \* \*' \}\]/);
  assert.match(yaml, /vars\.FDCI_AUTOMATION_ENABLED == 'true'/);
  assert.match(yaml, /github\.event\.repository\.default_branch/);
  assert.match(yaml, /FDCI_SCOPE: active/);
  assert.doesNotMatch(yaml, /FDCI_SCOPE: \$\{\{ inputs\.scope \}\}/);
  assert.match(yaml, /group: fdci-import/);
});

test("FDCI abre una compuerta autolimitada y la cierra incluso ante fallos", () => {
  const yaml = readFileSync(new URL("../.github/workflows/fdci-import.yml", import.meta.url), "utf8");
  assert.match(yaml, /scripts\/import-gate\.mjs preflight/);
  assert.match(yaml, /scripts\/import-gate\.mjs run/);
  assert.match(yaml, /scripts\/import-gate\.mjs close/);
  assert.match(yaml, /IMPORT_GATE_TTL_SECONDS: '600'/);
  assert.match(yaml, /if: always\(\)/);
  assert.match(yaml, /set -o pipefail/);
  assert.match(yaml, /tee fdci-import\.json/);
  assert.match(yaml, /complete sweep claimed: no/);
  assert.match(yaml, /timeout-minutes: 12/);
});

test("FDCI exige destino, SHA separado y límites fijos sin exponer secretos al checkout", () => {
  const yaml = readFileSync(new URL("../.github/workflows/fdci-import.yml", import.meta.url), "utf8");
  assert.match(yaml, /IMPORT_GATEWAY_TARGET: \$\{\{ vars\.IMPORT_GATEWAY_TARGET \}\}/);
  assert.match(yaml, /IMPORT_GATEWAY_PRODUCTION_ENABLED: \$\{\{ vars\.IMPORT_GATEWAY_PRODUCTION_ENABLED \}\}/);
  assert.match(yaml, /IMPORT_GATEWAY_APPROVED_SHA: \$\{\{ vars\.FDCI_IMPORT_APPROVED_SHA \}\}/);
  assert.match(yaml, /test "\$IMPORT_REF" = "\$APPROVED_SHA"/);
  assert.match(yaml, /FDCI_MAX_REQUESTS: '6'/);
  assert.match(yaml, /FDCI_MAX_PUBLICATIONS: '2'/);
  assert.match(yaml, /FDCI_PAUSE_MS: '400'/);
  assert.doesNotMatch(yaml, /options:.*full|d321e722/);
  assert.ok(yaml.indexOf("scripts/import-gate.mjs preflight") < yaml.indexOf("scripts/import-gate.mjs run"));
  const jobEnv = yaml.slice(yaml.indexOf("    env:"), yaml.indexOf("    steps:"));
  assert.doesNotMatch(jobEnv, /secrets\./);
  assert.match(yaml, /persist-credentials: false/);
  assert.match(yaml, /group: fdci-import\r?\n  cancel-in-progress: false/);
  assert.match(yaml, /if: always\(\) && steps.preflight.outcome == 'success' && steps.dispatch.outcome != 'skipped'/);
  assert.match(yaml, /IMPORT_GATE_RUN_ID: \$\{\{ github.run_id \}\}-\$\{\{ github.run_attempt \}\}/);
});

test("el build Linux se dispara solo en la rama aislada, sin secretos ni despliegue", () => {
  const yaml = readFileSync(new URL("../.github/workflows/build-1.2-linux.yml", import.meta.url), "utf8");
  assert.match(yaml, /^  push:\r?\n    branches: \[feat\/1\.2-sync-integration\]/m);
  assert.match(yaml, /^  workflow_dispatch:/m);
  assert.doesNotMatch(yaml, /^\s+schedule:/m);
  assert.match(yaml, /pnpm install --frozen-lockfile/);
  assert.match(yaml, /pnpm build/);
  assert.doesNotMatch(yaml, /secrets\.|wrangler deploy|D1_DATABASE_ID/);
});
