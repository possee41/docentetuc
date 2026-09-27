import assert from "node:assert/strict";
import test from "node:test";
import { usefulInformation } from "./useful-information.ts";

const search = (query: string) => usefulInformation.filter((item) => JSON.stringify(item).toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").includes(query.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")));

for (const query of ["no cobre", "me liquidaron mal", "Junta Secundaria", "legajo", "certificado FDCI", "jubilacion", "CIIDEPT", "DigiTUC", "titulo", "licencia", "expediente"]) {
  test(`encuentra información útil para ${query}`, () => assert.ok(search(query).length > 0));
}

test("toda ficha conserva fuente y fecha de verificación", () => {
  for (const item of usefulInformation) { assert.match(item.officialUrl, /^https:\/\//); assert.match(item.metadata.lastVerified, /^\d{4}-\d{2}-\d{2}$/); }
});
