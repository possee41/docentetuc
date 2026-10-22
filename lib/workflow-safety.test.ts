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

test("el build Linux es manual, sin secretos ni despliegue", () => {
  const yaml = readFileSync(new URL("../.github/workflows/build-1.2-linux.yml", import.meta.url), "utf8");
  assert.match(yaml, /^  workflow_dispatch:/m);
  assert.doesNotMatch(yaml, /^\s+schedule:/m);
  assert.match(yaml, /pnpm install --frozen-lockfile/);
  assert.match(yaml, /pnpm build/);
  assert.doesNotMatch(yaml, /secrets\.|wrangler deploy|D1_DATABASE_ID/);
});
