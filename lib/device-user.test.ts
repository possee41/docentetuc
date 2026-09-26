import assert from "node:assert/strict";
import test from "node:test";
import { deviceUser } from "./device-user.ts";

test("acepta solamente identificadores de dispositivo con formato UUID", () => {
  assert.equal(deviceUser("not-a-device"), null);
  assert.equal(deviceUser("550e8400-e29b-41d4-a716-446655440000")?.userId, "device:550e8400-e29b-41d4-a716-446655440000");
});
