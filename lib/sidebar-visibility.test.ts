import assert from "node:assert/strict";
import { test } from "node:test";
import { sidebarIsOpen, updateSidebarVisibility } from "./sidebar-visibility.ts";

test("el menú cerrado abre temporalmente al acercar el mouse y vuelve a cerrar al salir", () => {
  const closed = { pinned: false, hovered: false };
  const hovered = updateSidebarVisibility(closed, { type: "hover-enter" });
  assert.equal(sidebarIsOpen(hovered), true);
  assert.deepEqual(updateSidebarVisibility(hovered, { type: "hover-leave" }), closed);
});

test("el botón fija un menú abierto temporalmente y permite cerrarlo otra vez", () => {
  const hovered = { pinned: false, hovered: true };
  const pinned = updateSidebarVisibility(hovered, { type: "toggle-pin" });
  assert.deepEqual(pinned, { pinned: true, hovered: false });
  assert.equal(sidebarIsOpen(updateSidebarVisibility(pinned, { type: "hover-leave" })), true);
  assert.equal(sidebarIsOpen(updateSidebarVisibility(pinned, { type: "toggle-pin" })), false);
});

test("el cierre explícito retira la fijación del menú", () => {
  const pinned = { pinned: true, hovered: false };
  assert.equal(sidebarIsOpen(pinned), true);
  assert.deepEqual(updateSidebarVisibility(pinned, { type: "set-open", open: false }), { pinned: false, hovered: false });
});
