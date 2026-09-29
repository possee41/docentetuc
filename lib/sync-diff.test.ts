import test from "node:test";
import assert from "node:assert/strict";
import { hasMeaningfulPublicationChange, hashSourceSnapshot } from "./sync-diff.ts";
import { notificationDedupeKey } from "./notification-events.ts";

test("source sync fingerprints include derived metadata so SIME identifiers are persisted", async () => {
  const sourceRecord = { id: 140369, codigo: "PDVC-20260928-141298" };
  const derivedMetadata = { simeCode: sourceRecord.codigo, simeRecordId: String(sourceRecord.id) };
  const initial = await hashSourceSnapshot(sourceRecord, derivedMetadata);
  assert.equal(await hashSourceSnapshot(sourceRecord, derivedMetadata), initial);
  assert.notEqual(await hashSourceSnapshot(sourceRecord, { ...derivedMetadata, simeCode: "PDVC-UPDATED" }), initial);
});

test("hash-only parser changes do not create user-facing change alerts", () => {
  const previous = { status: "vigente", startsAt: null, endsAt: "2026-10-01", title: "Cargo", summary: "Cargo docente", category: "Vacante", level: "Secundario", area: "Historia", junta: "Junta", location: "Tafí Viejo", shift: "Mañana", character: "Interino", sourceUpdatedAt: null, circuit: "UNKNOWN", contentHash: "old" };
  assert.equal(hasMeaningfulPublicationChange(previous, { ...previous, circuit: "III", contentHash: "new" }), false);
});

test("a meaningful source date or content change remains alertable", () => {
  const previous = { status: "vigente", endsAt: "2026-10-01", summary: "Cargo docente" };
  assert.equal(hasMeaningfulPublicationChange(previous, { ...previous, status: "cerrada" }), true);
  assert.equal(hasMeaningfulPublicationChange(previous, { ...previous, endsAt: "2026-10-02" }), true);
  assert.equal(hasMeaningfulPublicationChange(previous, { ...previous, summary: "Cargo actualizado" }), true);
});

test("logical event keys deduplicate retries but distinguish a new event", () => {
  const first = notificationDedupeKey("sime:42", "DESIGNACION_CAMBIO", "change:abc123");
  assert.equal(notificationDedupeKey("sime:42", "DESIGNACION_CAMBIO", "change:abc123"), first);
  assert.notEqual(notificationDedupeKey("sime:42", "DESIGNACION_CAMBIO", "change:def456"), first);
  assert.ok(notificationDedupeKey("x".repeat(300), "EVENTO", "identity").length <= 255);
});
