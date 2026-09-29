import assert from "node:assert/strict";
import test from "node:test";
import { buildAIContext, detectIntent, GeminiProvider, retrievePublications } from "./ai.ts";
import { usefulInformation } from "./useful-information.ts";
import type { Profile, Publication } from "./types.ts";

const base = { source: "Capacitación Docente", external_id: "1", kind: "capacitacion", category: "Capacitación", summary: "", level: "Secundario", area: "Ciencias Sociales", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, official_url: "https://oficial.test/1", metadata: "{}", first_seen_at: "2026-09-01", updated_at: "2026-09-26" } as Publication;
const records = [{ ...base, id: "next", title: "Curso próximo", status: "próximamente" }, { ...base, id: "open", title: "Curso abierto", status: "inscripción abierta" }] as Publication[];
const vacancy = { ...base, id: "vacancy", kind: "vacante", category: "Vacante", title: "Horas de Filosofía", area: "Filosofía", status: "vigente" } as Publication;
const publicDocument = { ...base, id: "comunicado", kind: "junta", category: "Comunicados", title: "Comunicado Secundaria", summary: "Presentación de documentación hasta el 30 de septiembre", status: "vigente" } as Publication;
const openCall = { ...base, id: "llamado", kind: "junta", category: "Llamados abiertos", title: "Convocatoria abierta de Inicial", status: "vigente" } as Publication;
const usefulRecords = usefulInformation.map((item) => ({ ...base, id: `info:${item.id}`, external_id: item.id, kind: "informacion", category: item.category, title: item.title, summary: item.summary, level: "", area: (item.metadata.aliases || []).join(" · "), status: "vigente", official_url: item.officialUrl, metadata: JSON.stringify(item.metadata) })) as Publication[];

test("recupera primero la próxima inscripción usando datos reales", () => assert.equal(retrievePublications("¿Qué capacitación abre primero?", records)[0]?.id, "next"));
test("una conversación general no adjunta fuentes irrelevantes", () => assert.equal(buildAIContext("Hola", records).sources.length, 0));
test("recupera capacitaciones que abren próximamente", () => assert.equal(retrievePublications("¿Qué capacitaciones abren próximamente?", records)[0]?.id, "next"));
test("no agrega el perfil al contexto sin autorización", () => assert.match(buildAIContext("capacitaciones", records).context, /no autorizó usar su perfil/));

const profile = { user_id: "u", name: "Docente", level: "Secundario", levels: ["Secundario"], area: "Ciencias Sociales, Filosofía", areas: ["Ciencias Sociales", "Filosofía"], subjects: [], junta: "", boards: [], roles: [], department: "", locality: "", shifts: [], characters: [], circuits: [], personal_match_threshold: 85, training_match_threshold: 80, wants_interim: true, wants_substitute: true, training_interests: ["Ciencias Sociales"], notify_new_trainings: false, training_notify_scope: "relevant" } as Profile;

test("usa el matching real y conserva su porcentaje", () => {
  const result = buildAIContext("¿Qué capacitaciones coinciden con mi perfil?", records, { profile });
  assert.match(result.context, /Compatibilidad calculada por DocenteTuc: \d+%; confianza: \d+%/);
});

test("no recomienda una vacante con sólo dos criterios conocidos", () => {
  const result = buildAIContext("¿Qué vacantes coinciden conmigo?", [...records, vacancy], { profile });
  assert.deepEqual(result.sources.map((source) => source.id), []);
});

test("recupera vacantes compatibles con evidencia suficiente usando el matching real", () => {
  const vacancyWithCircuit = { ...vacancy, circuit: "II" };
  const profileWithCircuit = { ...profile, circuits: ["II"] };
  const result = buildAIContext("¿Qué vacantes coinciden conmigo?", [...records, vacancyWithCircuit], { profile: profileWithCircuit });
  assert.deepEqual(result.sources.map((source) => source.id), ["vacancy"]);
  assert.match(result.context, /Compatibilidad calculada por DocenteTuc/);
});

test("limita la agenda a los eventos guardados", () => {
  const result = buildAIContext("¿Qué tengo en mi agenda?", records, { agendaIds: ["open"] });
  assert.deepEqual(result.sources.map((source) => source.id), ["open"]);
});

test("prioriza la publicación abierta desde su detalle", () => {
  const result = retrievePublications("¿Cuándo abre esta?", records, 8, { context: { type: "capacitacion", id: "open" } });
  assert.equal(result[0]?.id, "open");
});

test("clasifica localmente las intenciones principales", () => {
  assert.equal(detectIntent("¿Qué capacitaciones abren esta semana?"), "capacitaciones");
  assert.equal(detectIntent("¿Qué vacantes coinciden conmigo?"), "vacantes");
  assert.equal(detectIntent("¿Qué tengo mañana?"), "agenda");
  assert.equal(detectIntent("Buscá un padrón docente"), "documentos");
  assert.equal(detectIntent("Me liquidaron mal el sueldo"), "informacion");
  assert.equal(detectIntent("Hola"), "conversacion_general");
});

test("recupera trámites y contactos oficiales sin inventar campos ausentes", () => {
  const cases = [
    ["No cobré el sueldo", "info:novedades-salariales"],
    ["Necesito hacer mi legajo", "info:legajo"],
    ["¿Dónde consulto mi expediente?", "info:expedientes"],
    ["Tengo problemas con mi certificado FDCI", "info:certificacion-fdci"],
    ["¿Qué oficinas hay en CIIDEPT?", "info:ciidept"],
  ];
  for (const [question, expected] of cases) {
    const result = buildAIContext(question, usefulRecords);
    assert.equal(result.sources[0]?.id, expected, question);
    assert.match(result.context, /Datos oficiales publicados:/);
  }
  assert.match(buildAIContext("Tengo problemas con mi certificado FDCI", usefulRecords).context, /no publicado/);
});

test("agenda distingue mañana de otros eventos guardados", () => {
  const dated = [{ ...records[0], id: "tomorrow", ends_at: "2026-09-28T12:00:00-03:00" }, { ...records[1], id: "later", ends_at: "2026-10-02T12:00:00-03:00" }] as Publication[];
  const result = retrievePublications("¿Qué tengo mañana?", dated, 8, { agendaIds: ["tomorrow", "later"], now: new Date("2026-09-27T10:00:00-03:00") });
  assert.deepEqual(result.map((item) => item.id), ["tomorrow"]);
});

test("expone como no informados los campos ausentes para evitar alucinaciones", () => {
  const context = buildAIContext("¿Cuántos cupos, requisitos y puntaje tiene este curso?", records, { context: { type: "capacitacion", id: "next" } }).context;
  assert.match(context, /Cupo: No informado/);
  assert.match(context, /Requisitos: No informados/);
  assert.match(context, /Puntaje: No informado/);
});

test("una publicación declarada inexistente no hereda el contexto de pantalla", () => {
  const result = buildAIContext("¿Cuándo abre una capacitación que no existe?", records, { context: { type: "capacitacion", id: "next" } });
  assert.equal(result.sources.length, 0);
  assert.match(result.context, /No se recuperaron registros oficiales suficientes/);
});

test("incluye el seguimiento personal de designaciones sin convertirlo en fuente oficial", () => {
  const result = buildAIContext("¿Dónde me inscribí?", [...records, vacancy], { designations: [{ id: "u:v", publication_id: "v", status: "INSCRIPTO", role: "Profesor de Psicología", subject: "Psicología", school: "Escuela X", address: "", locality: "Capital", applied_at: "2026-09-27T12:00:00Z", appointment_at: null, shift: "Mañana", board: "Secundaria", documentation: "", order_number: "", notes: "Llevar DNI", official_url: "https://example.com", reminder_at: null, reminder_notified: false, created_at: "2026-09-27", updated_at: "2026-09-27" }] });
  assert.match(result.context, /SEGUIMIENTO PERSONAL DE DESIGNACIONES/);
  assert.match(result.context, /Escuela X/);
});

test("recupera texto de comunicados y llamados desde el mismo RAG", () => {
  assert.deepEqual(retrievePublications("¿Qué comunicado pide documentación?", [publicDocument, openCall]).map((item) => item.id), ["comunicado"]);
  assert.deepEqual(retrievePublications("¿Qué llamados abiertos hay?", [publicDocument, openCall]).map((item) => item.id), ["llamado"]);
  assert.match(buildAIContext("documentación", [publicDocument]).context, /30 de septiembre/);
});

test("GeminiProvider usa el endpoint backend y la clave sólo en el header", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "", requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => { requestUrl = String(input); requestInit = init; return Response.json({ candidates: [{ content: { parts: [{ text: "Respuesta real" }] } }] }); };
  try {
    assert.equal(await new GeminiProvider("secret-test", "gemini-3.5-flash-lite").generate("Hola", "Sistema"), "Respuesta real");
    assert.match(requestUrl, /gemini-3\.5-flash-lite:generateContent$/);
    assert.doesNotMatch(requestUrl, /secret-test/);
    assert.equal((requestInit?.headers as Record<string, string>)["x-goog-api-key"], "secret-test");
    assert.match(String(requestInit?.body), /systemInstruction/);
  } finally { globalThis.fetch = originalFetch; }
});
