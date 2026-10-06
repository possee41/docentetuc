import assert from "node:assert/strict";
import test from "node:test";
import { APP_PUBLICATIONS_QUERY } from "./app-publications-query.ts";
import { designationEmptyState, hasDesignationProfilePreferences } from "./designation-state.ts";

test("Todas queda disponible sin Perfil docente ni sesión Google", () => {
  const state = designationEmptyState({ filter: "todas", profileConfigured: false, availableCount: 2, sourceStatus: "OK" });
  assert.deepEqual(state, { profileRequired: false, sourceUnavailable: false, sourceVerifiedEmpty: false });
  assert.match(APP_PUBLICATIONS_QUERY, /SELECT \* FROM publications/);
  assert.doesNotMatch(APP_PUBLICATIONS_QUERY, /user_id|profile|account|google/i);
});

test("Para mí pide completar el Perfil docente cuando no hay preferencias de matching", () => {
  assert.equal(hasDesignationProfilePreferences(null), false);
  assert.equal(hasDesignationProfilePreferences({ levels: [], roles: [] }), false);
  assert.equal(hasDesignationProfilePreferences({ levels: ["Secundario"] }), true);
  assert.equal(designationEmptyState({ filter: "para-mi", profileConfigured: false, availableCount: 5, sourceStatus: "OK" }).profileRequired, true);
});

test("distingue una fuente que verificó cero designaciones de una sincronización fallida", () => {
  assert.deepEqual(designationEmptyState({ filter: "todas", profileConfigured: false, availableCount: 0, sourceStatus: "OK" }), {
    profileRequired: false, sourceUnavailable: false, sourceVerifiedEmpty: true,
  });
  assert.deepEqual(designationEmptyState({ filter: "todas", profileConfigured: false, availableCount: 0, sourceStatus: "DNS_ERROR" }), {
    profileRequired: false, sourceUnavailable: true, sourceVerifiedEmpty: false,
  });
  assert.equal(designationEmptyState({ filter: "todas", profileConfigured: false, availableCount: 0 }).sourceUnavailable, true);
  assert.equal(designationEmptyState({ filter: "para-mi", profileConfigured: false, availableCount: 0, sourceStatus: "DNS_ERROR" }).profileRequired, true);
  assert.equal(designationEmptyState({ filter: "para-mi", profileConfigured: false, availableCount: 0, sourceStatus: "DNS_ERROR" }).sourceUnavailable, true);
});
