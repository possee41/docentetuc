import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { combineAppData } from "./app-data.ts";
import type { PrivateAppData } from "./app-data.ts";
import type { AppData } from "./types.ts";

const publicData = {
  profile: null, publications: [{ id: "fdci:commission:6397" }, { id: "sime:1" }], sync: [{ source: "FDCI" }],
  saved: [], notifications: [], reminders: [], designations: [], manualEvents: [],
} as unknown as AppData;
const privateData = {
  profile: { user_id: "test-user" }, saved: [{ publication_id: "fdci:commission:6397" }],
  notifications: [], reminders: [], designations: [], manualEvents: [],
} as unknown as PrivateAppData;

test("el catálogo público se combina una sola vez con perfil y seguimiento privado", () => {
  const combined = combineAppData(publicData, privateData);
  assert.deepEqual(combined?.publications.map((item) => item.id), ["fdci:commission:6397", "sime:1"]);
  assert.equal(combined?.profile?.user_id, "test-user");
  assert.equal(combined?.saved[0]?.publication_id, "fdci:commission:6397");
  assert.deepEqual(combined?.sync, publicData.sync);
});

test("un fallo privado conserva las publicaciones públicas y una respuesta pública posterior conserva el perfil", () => {
  assert.equal(combineAppData(publicData, null), publicData);
  const newerPublic = { ...publicData, publications: [{ ...publicData.publications[0], id: "fdci:commission:6400" }] };
  const combined = combineAppData(newerPublic, privateData);
  assert.equal(combined?.publications[0]?.id, "fdci:commission:6400");
  assert.equal(combined?.profile?.user_id, "test-user");
  assert.deepEqual(combined?.saved, privateData.saved);
});

test("/api/app no consulta ni devuelve el catálogo público; el cliente descarta respuestas atrasadas", () => {
  const route = readFileSync(new URL("../app/api/app/route.ts", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(route, /APP_PUBLICATIONS_QUERY|publications: publications\.results|sync: sync\.results/u);
  assert.match(client, /requestId !== publicLoadSequence\.current/u);
  assert.match(client, /requestId !== privateLoadSequence\.current/u);
  assert.match(client, /setData\(combineAppData\(result, privateData\.current\)\)/u);
  assert.match(client, /setData\(combineAppData\(publicData\.current, result\)\)/u);
  assert.match(client, /await loadPublic\(\);\s*await loadRef\.current\(false, false\)/u);
});
