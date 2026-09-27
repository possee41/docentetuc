import assert from "node:assert/strict";
import test from "node:test";
import { driveEntryUrl, htmlToText, parsePublicDriveFolder } from "./public-documents.ts";

test("convierte un comunicado HTML en texto legible y seguro", () => {
  assert.equal(htmlToText("<style>x{}</style><h1>Comunicado &amp; novedades</h1><p>Inscripci&oacute;n, Educaci&Oacute;n y padr&oacute;n N&deg; 1 &ndash; Tucum&aacute;n</p><script>alert(1)</script>"), "Comunicado & novedades\nInscripción, EducaciÓn y padrón N° 1 – Tucumán");
});

test("recupera solamente elementos directos de una carpeta pública de Drive", () => {
  const payload = JSON.stringify([[["file-1", ["folder-1"], "Padrón definitivo.pdf", "application/pdf", 0, 1_760_000_000_000], ["nested", ["other"], "Otro", "application/pdf"]]]).replace(/[\[\]"]/g, (value) => `\\x${value.charCodeAt(0).toString(16)}`);
  const items = parsePublicDriveFolder(`<script>window['_DRIVE_ivd'] = '${payload}';</script>`, "folder-1");
  assert.deepEqual(items, [{ id: "file-1", name: "Padrón definitivo.pdf", mimeType: "application/pdf", updatedAt: "2025-10-09T08:53:20.000Z" }]);
  assert.equal(driveEntryUrl(items[0]), "https://drive.google.com/file/d/file-1/view");
});
