import assert from "node:assert/strict";
import test from "node:test";
import { canaryLeaseDeadline } from "./fdci-canary-lease-time.mjs";

const at = offset => new Date(Date.parse("2026-11-28T02:26:15.000Z") + offset).toISOString();
const ack = shift => ({ openedAt: at(shift), expiresAt: at(shift + 180_000) });

test("server clock skew in either direction cannot shorten or extend the lease", () => {
  for (const shift of [-60_000, 0, 60_000])
    assert.equal(canaryLeaseDeadline(ack(shift), 1_000, 2_000, 180), 151_000);
});

test("expired lease and the 30-second closure margin stop insertion", () => {
  assert.throws(() => canaryLeaseDeadline(ack(0), 1_000, 151_000, 180), /MARGIN_EXHAUSTED/);
  assert.throws(() => canaryLeaseDeadline(ack(0), 1_000, 181_000, 180), /MARGIN_EXHAUSTED/);
  assert.ok(150_999 < canaryLeaseDeadline(ack(0), 1_000, 2_000, 180));
  assert.ok(151_000 >= canaryLeaseDeadline(ack(0), 1_000, 2_000, 180));
});

test("the requested TTL and the absolute 600-second cap are both enforced", () => {
  const longer = seconds => ({ openedAt: at(0), expiresAt: at(seconds * 1_000) });
  assert.throws(() => canaryLeaseDeadline(longer(181), 1_000, 2_000, 180), /TIME_INVALID/);
  assert.equal(canaryLeaseDeadline(longer(600), 1_000, 2_000, 600), 571_000);
  assert.throws(() => canaryLeaseDeadline(longer(601), 1_000, 2_000, 900), /TIME_INVALID/);
  assert.throws(() => canaryLeaseDeadline({ ...ack(0), expiresAt: at(-1) }, 1_000, 2_000, 180), /TIME_INVALID/);
});
