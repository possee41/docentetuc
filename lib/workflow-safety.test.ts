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
  assert.match(yaml, /github\.event_name == 'schedule' && 'active' \|\| inputs\.scope/);
  assert.doesNotMatch(yaml, /FDCI_SCOPE: \$\{\{ inputs\.scope \}\}/);
  assert.match(yaml, /group: fdci-import/);
});

test("FDCI abre una compuerta autolimitada y la cierra incluso ante fallos", () => {
  const yaml = readFileSync(new URL("../.github/workflows/fdci-import.yml", import.meta.url), "utf8");
  assert.match(yaml, /scripts\/import-gate\.mjs open/);
  assert.match(yaml, /scripts\/import-gate\.mjs close/);
  assert.match(yaml, /IMPORT_GATE_TTL_SECONDS: '600'/);
  assert.match(yaml, /if: always\(\)/);
  assert.match(yaml, /set -o pipefail/);
  assert.match(yaml, /tee fdci-import\.json/);
  assert.match(yaml, /complete sweep claimed: no/);
  assert.match(yaml, /timeout-minutes: 10/);
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
