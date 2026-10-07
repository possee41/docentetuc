import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const accountUi = readFileSync(new URL("../components/account-sign-in-section.tsx", import.meta.url), "utf8");
const privacyPage = readFileSync(new URL("../app/privacidad/page.tsx", import.meta.url), "utf8");
const deletionPage = readFileSync(new URL("../app/eliminar-datos/page.tsx", import.meta.url), "utf8");
const aiChatRoute = readFileSync(new URL("../app/api/ai/chat/route.ts", import.meta.url), "utf8");

test("la vinculación explica que solo asocia datos DocenteTuc y conserva la opción de no vincular", () => {
  assert.ok(accountUi.includes("Vincular mis datos a mi cuenta"));
  assert.ok(!accountUi.includes("Vincular este dispositivo"));
  assert.ok(accountUi.includes("Continuar sin vincular"));
  assert.ok(accountUi.includes("No permite controlar tu teléfono ni acceder a tus archivos, contactos, fotos"));
  assert.ok(accountUi.includes("tampoco amplía los permisos de Google"));
});

test("las páginas públicas separan Google privado, perfil público y perfil docente", () => {
  assert.ok(privacyPage.includes("DocenteTuc no solicita ni recibe tu contraseña."));
  assert.ok(privacyPage.includes("La foto de Google es privada y no reemplaza ni se publica como ese avatar"));
  assert.ok(privacyPage.includes("Perfil docente privado"));
  assert.ok(privacyPage.includes("«Guardadas» es privada"));
  assert.ok(privacyPage.includes("90 días"));
  assert.ok(privacyPage.includes("Open-Meteo"));
  assert.ok(privacyPage.includes("creativecommons.org/licenses/by/4.0"));
  assert.ok(deletionPage.includes("Las instalaciones heredadas no tienen esa prueba criptográfica"));
  assert.ok(deletionPage.includes("si se pierde la cookie de protección, tampoco podemos verificar la instalación actual"));
  assert.ok(deletionPage.includes("Eliminar mis datos"));
  assert.ok(deletionPage.includes("no elimina tu cuenta Google"));
  assert.ok(deletionPage.includes("No envíes tu contraseña de Google"));
  assert.ok(accountUi.includes("Los datos separados de otras instalaciones no vinculadas no se eliminan desde aquí"));
  assert.ok(privacyPage.includes("Los datos separados de otras instalaciones no vinculadas no se eliminan al borrar la cuenta desde otro dispositivo"));
  assert.ok(deletionPage.includes("borrá cada instalación protegida desde ese mismo dispositivo mientras conserve su credencial"));
});

test("la privacidad de IA describe proveedor externo, fuentes, personalización y caché temporal", () => {
  const aiSection = privacyPage.split('aria-labelledby="ia"')[1]?.split("</section>")[0] || "";
  assert.ok(aiSection.includes("servicio externo de inteligencia artificial"));
  assert.ok(aiSection.includes("hasta seis mensajes recientes"));
  assert.ok(aiSection.includes("sin historial, perfil autorizado ni contexto de una publicación"));
  assert.ok(aiSection.includes("Puede reutilizar esa respuesta durante cinco minutos"));
  assert.ok(aiSection.includes("la entrada puede permanecer temporalmente en memoria"));
  assert.ok(aiSection.includes("no navega libremente por Internet"));
  assert.ok(!/usamos Gemini|usamos OpenAI/i.test(aiSection));
  assert.match(aiChatRoute, /!useProfile && !history && !context && !sourceIssues\.length/);
  assert.match(aiChatRoute, /aiResponseCacheKey\(user\.userId,/);
  assert.match(aiChatRoute, /useProfile \? db\.prepare\("SELECT \* FROM profiles/);
});

test("las páginas públicas no incluyen URLs locales de desarrollo", () => {
  assert.ok(!/http:\/\/localhost(?::\d+)?/u.test(privacyPage));
  assert.ok(!/http:\/\/localhost(?::\d+)?/u.test(deletionPage));
});
