import assert from "node:assert/strict";
import test from "node:test";
import { buildAIContext, GeminiProvider, retrievePublications } from "./ai.ts";
import type { Profile, Publication } from "./types.ts";

const base = { source: "Capacitación Docente", external_id: "1", kind: "capacitacion", category: "Capacitación", summary: "", level: "Secundario", area: "", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, official_url: "https://oficial.test/1", metadata: "{}", first_seen_at: "2026-09-01", updated_at: "2026-09-26" } as Publication;
const records = [{ ...base, id: "next", title: "Curso próximo", status: "próximamente" }, { ...base, id: "open", title: "Curso abierto", status: "inscripción abierta" }] as Publication[];
const vacancy = { ...base, id: "vacancy", kind: "vacante", category: "Vacante", title: "Horas de Filosofía", status: "vigente" } as Publication;

test("recupera primero la próxima inscripción usando datos reales", () => assert.equal(retrievePublications("¿Qué capacitación abre primero?", records)[0]?.id, "next"));
test("una conversación general no adjunta fuentes irrelevantes", () => assert.equal(buildAIContext("Hola", records).sources.length, 0));
test("recupera capacitaciones que abren próximamente", () => assert.equal(retrievePublications("¿Qué capacitaciones abren próximamente?", records)[0]?.id, "next"));
test("no agrega el perfil al contexto sin autorización", () => assert.match(buildAIContext("capacitaciones", records).context, /no autorizó usar su perfil/));

const profile = { user_id: "u", name: "Docente", level: "Secundario", levels: ["Secundario"], area: "", areas: [], subjects: [], junta: "", boards: [], department: "", locality: "", shifts: [], wants_interim: true, wants_substitute: true, training_interests: [], notify_new_trainings: false, training_notify_scope: "relevant" } as Profile;

test("usa el matching real y conserva su porcentaje", () => {
  const result = buildAIContext("¿Qué capacitaciones coinciden con mi perfil?", records, { profile });
  assert.match(result.context, /Coincidencia calculada por DocenteTuc: \d+%/);
});

test("recupera vacantes compatibles usando el matching real", () => {
  const result = buildAIContext("¿Qué vacantes coinciden conmigo?", [...records, vacancy], { profile });
  assert.deepEqual(result.sources.map((source) => source.id), ["vacancy"]);
  assert.match(result.context, /Coincidencia calculada por DocenteTuc/);
});

test("limita la agenda a los eventos guardados", () => {
  const result = buildAIContext("¿Qué tengo en mi agenda?", records, { agendaIds: ["open"] });
  assert.deepEqual(result.sources.map((source) => source.id), ["open"]);
});

test("prioriza la publicación abierta desde su detalle", () => {
  const result = retrievePublications("¿Cuándo abre esta?", records, 8, { context: { type: "capacitacion", id: "open" } });
  assert.equal(result[0]?.id, "open");
});

test("GeminiProvider usa el endpoint backend y la clave sólo en el header", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "", requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => { requestUrl = String(input); requestInit = init; return Response.json({ candidates: [{ content: { parts: [{ text: "Respuesta real" }] } }] }); };
  try {
    assert.equal(await new GeminiProvider("secret-test", "gemini-2.5-flash-lite").generate("Hola", "Sistema"), "Respuesta real");
    assert.match(requestUrl, /gemini-2\.5-flash-lite:generateContent$/);
    assert.doesNotMatch(requestUrl, /secret-test/);
    assert.equal((requestInit?.headers as Record<string, string>)["x-goog-api-key"], "secret-test");
    assert.match(String(requestInit?.body), /systemInstruction/);
  } finally { globalThis.fetch = originalFetch; }
});
