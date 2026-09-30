import test from "node:test";
import assert from "node:assert/strict";
import { diffByHash, hasMeaningfulPublicationChange, hashSourceSnapshot, isDocumentTextExportMigration } from "./sync-diff.ts";
import { notificationDedupeKey } from "./notification-events.ts";
import { missingAfterValidatedSync } from "./publication-lifecycle.ts";

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

test("cambiar de HTML a texto no avisa como comunicado nuevo si la fuente no cambió", () => {
  const previous = JSON.stringify({ contentAvailable: true, format: "google-doc" });
  const current = JSON.stringify({ contentAvailable: true, format: "google-doc", textFormat: "txt" });
  assert.equal(isDocumentTextExportMigration(previous, current, null, null), true);
  assert.equal(isDocumentTextExportMigration(previous, current, "2026-09-29", "2026-09-30"), false);
});

test("logical event keys deduplicate retries but distinguish a new event", () => {
  const first = notificationDedupeKey("sime:42", "DESIGNACION_CAMBIO", "change:abc123");
  assert.equal(notificationDedupeKey("sime:42", "DESIGNACION_CAMBIO", "change:abc123"), first);
  assert.notEqual(notificationDedupeKey("sime:42", "DESIGNACION_CAMBIO", "change:def456"), first);
  assert.ok(notificationDedupeKey("x".repeat(300), "EVENTO", "identity").length <= 255);
});

test("un comunicado y un padrón nuevos se detectan sin duplicarse en el siguiente barrido", () => {
  const items = [
    { id: "padrones:com-secundaria", source: "Padrones y Comunicados", contentHash: "com-a" },
    { id: "drive:pad-primaria:nuevo", source: "Padrones y Comunicados", contentHash: "pad-a" },
  ];
  assert.deepEqual(diffByHash(new Map(), items).fresh.map((item) => item.id), items.map((item) => item.id));
  const saved = new Map(items.map((item) => [item.id, { content_hash: item.contentHash }]));
  assert.equal(diffByHash(saved, items).fresh.length, 0);
  assert.deepEqual(diffByHash(saved, [{ ...items[0], contentHash: "com-b" }, items[1]]).changed.map((item) => item.id), [items[0].id]);
});

test("un llamado ausente caduca sólo tras una lectura íntegra de su carpeta", () => {
  const previous = ["drive:abiertos-primaria:viejo", "drive:abiertos-primaria:actual"];
  const current = ["drive:abiertos-primaria:actual"];
  assert.deepEqual(missingAfterValidatedSync(previous, current, "PARTIAL"), []);
  assert.deepEqual(missingAfterValidatedSync(previous, current, "OK"), [previous[0]]);
});
