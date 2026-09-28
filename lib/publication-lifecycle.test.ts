import assert from "node:assert/strict";
import test from "node:test";
import { assessSourceSync, canRecommendCurrentPublication, elapsedLabel, missingAfterValidatedSync, publicationLifecycle, sourceFreshness } from "./publication-lifecycle.ts";

const now = new Date("2026-09-28T12:00:00Z");

test("a missing SIME publication is removed only after a complete non-empty successful sync", () => {
  assert.deepEqual(missingAfterValidatedSync(["a", "b"], ["a"], "OK"), ["b"]);
  assert.deepEqual(missingAfterValidatedSync(["a", "b"], [], "EMPTY_SUSPECT"), []);
  assert.deepEqual(missingAfterValidatedSync(["a", "b"], ["a"], "PARTIAL"), []);
});

test("an unexpectedly empty feed preserves existing records", () => {
  assert.equal(assessSourceSync({ previousCount: 220, recordsFound: 0 }), "EMPTY_SUSPECT");
  assert.equal(assessSourceSync({ previousCount: 0, recordsFound: 0 }), "OK");
});

test("source failures are classified without pretending a successful verification", () => {
  assert.equal(assessSourceSync({ previousCount: 4, recordsFound: 0, error: new Error("HTTP 503 https://sime.example") }), "HTTP_ERROR");
  assert.equal(assessSourceSync({ previousCount: 4, recordsFound: 0, error: new Error("AbortError: timeout") }), "TIMEOUT");
  assert.equal(assessSourceSync({ previousCount: 4, recordsFound: 8, complete: false }), "PARTIAL");
  assert.equal(assessSourceSync({ previousCount: 4, recordsFound: 4, formatValid: false }), "FORMAT_CHANGED");
});

test("publication lifecycle distinguishes current, upcoming, closed, expired and uncertain", () => {
  assert.equal(publicationLifecycle({ sourceStatus: "vigente", sourceStatusIsExplicit: true, now }), "ACTIVE");
  assert.equal(publicationLifecycle({ registrationOpenAt: "2026-10-01T00:00:00Z", dateStatus: "confirmed", now }), "UPCOMING");
  assert.equal(publicationLifecycle({ registrationOpenAt: "2026-10-01T00:00:00Z", dateStatus: "tentative", now }), "UNKNOWN");
  assert.equal(publicationLifecycle({ sourceStatus: "finalizada", sourceStatusIsExplicit: true, registrationCloseAt: "2026-09-27T00:00:00Z", dateStatus: "tentative", now }), "UNKNOWN");
  assert.equal(publicationLifecycle({ registrationCloseAt: "2026-09-27T00:00:00Z", dateStatus: "general_window", now }), "UNKNOWN");
  assert.equal(publicationLifecycle({ registrationCloseAt: "2026-09-27T00:00:00Z", now }), "CLOSED");
  assert.equal(publicationLifecycle({ expiresAt: "2026-09-27T00:00:00Z", now }), "EXPIRED");
  assert.equal(publicationLifecycle({ sourceStatus: "REMOVED_FROM_SOURCE", now }), "REMOVED_FROM_SOURCE");
  assert.equal(publicationLifecycle({ now }), "UNKNOWN");
});

test("home recommendation requires a current lifecycle and a recently successful source check", () => {
  const recent = { sync_status: "OK", last_successful_sync_at: "2026-09-28 11:00:00" };
  assert.equal(canRecommendCurrentPublication({ lifecycle: "ACTIVE", health: recent, now }), true);
  assert.equal(canRecommendCurrentPublication({ lifecycle: "REMOVED_FROM_SOURCE", health: recent, now }), false);
  assert.equal(canRecommendCurrentPublication({ lifecycle: "ACTIVE", health: { ...recent, last_successful_sync_at: "2026-09-25 11:00:00" }, now }), false);
  assert.equal(sourceFreshness(undefined, now).fresh, false);
});

test("freshness labels are source-specific and tolerate timestamp formats", () => {
  assert.equal(elapsedLabel("2026-09-28 11:30:00", now), "verificado hace 30 min");
  assert.equal(elapsedLabel(null, now), "sin verificación exitosa");
});
