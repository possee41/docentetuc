import assert from "node:assert/strict";
import test from "node:test";
import { driveEntryUrl, htmlToText, parseEmbeddedDriveFolder, parsePublicDriveFolder, parsePublicDrivePage, plainDocumentText } from "./public-documents.ts";

test("convierte un comunicado HTML en texto legible y seguro", () => {
  assert.equal(htmlToText("<style>x{}</style><h1>Comunicado &amp; novedades</h1><p>Inscripci&oacute;n, Educaci&Oacute;n y padr&oacute;n N&deg; 1 &ndash; Tucum&aacute;n</p><script>alert(1)</script>"), "Comunicado & novedades\nInscripción, EducaciÓn y padrón N° 1 – Tucumán");
});

test("Drive anuncia continuación, no confunde las primeras 50 entradas con una instantánea completa", () => {
  const entries = Array.from({ length: 50 }, (_, i) => [`file-${i}`, ["root"], `Test ${i}`, "application/pdf"]);
  const html = `<script>window['_DRIVE_ivd'] = '${JSON.stringify([entries, null, null, null, [[null, 50, entries[49], "synthetic-cursor"]]])}';</script>`;
  const page = parsePublicDrivePage(html, "root");
  assert.equal(page.entries.length, 50);
  assert.equal(page.nextCursor, "embedded");
});

test("reconoce el marcador observado de carpeta vacía sin tratar un esquema inválido como vacío", () => {
  const html = `<script>window['_DRIVE_ivd'] = '${JSON.stringify([null, null, null, null, [[[]]], 1])}';</script>`;
  assert.deepEqual(parsePublicDrivePage(html, "root"), { entries: [], nextCursor: null });
  assert.throws(() => parsePublicDrivePage("window['_DRIVE_ivd'] = '[null]';", "root"), /SCHEMA_ERROR/);
});

test("vista pública completa recupera 80 archivos, tipos y nombres sin aceptar HTML truncado", () => {
  const rows = Array.from({ length: 80 }, (_, i) => `<div class="flip-entry" id="entry-file-${i}"><a href="https://drive.google.com/file/d/file-${i}/view"><img src="https://drive-thirdparty.googleusercontent.com/16/type/application/pdf"><div class="flip-entry-title">Padrón &amp; ${i}</div></a></div>`).join("");
  const html = `<html><body><div class="flip-entries">${rows}</div></body></html>`;
  const parsed = parseEmbeddedDriveFolder(html);
  assert.equal(parsed.entries.length, 80);
  assert.equal(parsed.entries[0].name, "Padrón & 0");
  assert.equal(parsed.entries[0].mimeType, "application/pdf");
  assert.equal(parsed.nextCursor, null);
  assert.equal(parsed.fullListing, true);
  assert.throws(() => parseEmbeddedDriveFolder(html.slice(0, -10)), /truncated/);
  assert.throws(() => parseEmbeddedDriveFolder(html.replace('flip-entries', 'flip-entries load-more')), /pagination/);
  assert.throws(() => parseEmbeddedDriveFolder(html.replace('https://drive.google.com/file/d/file-0/', 'https://example.com/file/d/file-0/')), /does not match/);
});

test("limita un Google Doc exportado como texto sin alterar su contenido", () => {
  assert.equal(plainDocumentText("  COMUNICADO\r\n  29/09/2026\r\n\r\n\r\n <docente>  "), "COMUNICADO\n 29/09/2026\n\n <docente>");
  assert.equal(plainDocumentText("abcde", 3), "abc");
});

test("recupera solamente elementos directos de una carpeta pública de Drive", () => {
  const payload = JSON.stringify([[["file-1", ["folder-1"], "Padrón definitivo.pdf", "application/pdf", 0, 1_760_000_000_000], ["nested", ["other"], "Otro", "application/pdf"]]]).replace(/[\[\]"]/g, (value) => `\\x${value.charCodeAt(0).toString(16)}`);
  const items = parsePublicDriveFolder(`<script>window['_DRIVE_ivd'] = '${payload}';</script>`, "folder-1");
  assert.deepEqual(items, [{ id: "file-1", name: "Padrón definitivo.pdf", mimeType: "application/pdf", updatedAt: "2025-10-09T08:53:20.000Z" }]);
  assert.equal(driveEntryUrl(items[0]), "https://drive.google.com/file/d/file-1/view");
});
