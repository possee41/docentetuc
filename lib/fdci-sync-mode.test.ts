import assert from "node:assert/strict";
import test from "node:test";
import { fdciLegacyEnabled } from "./fdci-sync-mode.ts";

test("FDCI legacy stays enabled by default and is excluded only by explicit external mode", () => {
  assert.equal(fdciLegacyEnabled(), true);
  assert.equal(fdciLegacyEnabled("legacy"), true);
  assert.equal(fdciLegacyEnabled("external"), false);
  assert.equal(fdciLegacyEnabled("EXTERNAL"), true);
});
