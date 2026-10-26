import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { needsRecoveryNotice } from "./legacy-recovery-ui.ts";

const app = readFileSync(new URL("../app/docente-app.tsx", import.meta.url), "utf8");
const account = readFileSync(new URL("../components/account-sign-in-section.tsx", import.meta.url), "utf8");

test("una instalación que requiere recuperación no muestra datos privados como listas vacías", () => {
  assert.equal(needsRecoveryNotice("recovery_required", true, false, false), true);
  assert.equal(needsRecoveryNotice("recovery_required", false, false, false), false);
  assert.equal(needsRecoveryNotice("recovery_required", true, true, false), false);
  assert.equal(needsRecoveryNotice("recovery_required", true, false, true), false);
  assert.match(app, /privateView && !privateReady \? recoveryRequired \? <RecoveryRequiredNotice/);
  assert.ok(app.indexOf("privateView && !privateReady") < app.indexOf('view === "agenda" ? <Agenda'));
  assert.match(app, /Tu información anterior permanece conservada/);
  assert.match(app, /necesitamos verificar que te pertenece/);
  assert.match(app, /No se vinculará ni se recuperará ningún dato automáticamente/);
});

test("la recuperación legacy no bloquea los módulos públicos ni reutiliza un caché privado", () => {
  const publicRoute = readFileSync(new URL("../app/api/public-app/route.ts", import.meta.url), "utf8");
  assert.match(app, /fetch\("\/api\/public-app"/);
  assert.match(app, /if \(response\.status === 401\).*privateData\.current = null.*setPrivateReady\(false\).*setData\(publicData\.current\)/);
  assert.doesNotMatch(app, /getItem\("docentetuc-data-v1"\)/);
  assert.match(publicRoute, /APP_PUBLICATIONS_QUERY/);
  assert.doesNotMatch(publicRoute, /currentUser|getAuthenticatedAccount|SELECT \* FROM profiles|saved_publications|manual_events/);
});

test("instalaciones nuevas y cuentas autorizadas mantienen sus vistas normales", () => {
  assert.equal(needsRecoveryNotice("protected", true, false, false), false);
  assert.equal(needsRecoveryNotice("linked", true, false, false), false);
  assert.equal(needsRecoveryNotice("unavailable", true, false, false), false);
});

test("un error de autorización no se presenta como problema de conexión", () => {
  assert.doesNotMatch(app, /Revisá tu conexión y volvé a intentarlo/);
  assert.match(app, /<p className="mt-2 text-\[#61766f\]">\{error\}<\/p>/);
});

test("Cuenta ofrece el canal de soporte publicado sin automatizar la recuperación", () => {
  assert.match(account, /installationSecurity === "recovery_required"/);
  assert.match(account, /Tu información anterior permanece conservada/);
  assert.match(account, /mailto:soporte\.docentetuc@gmail\.com/);
  assert.match(account, /No se vinculará automáticamente/);
});
