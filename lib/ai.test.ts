import assert from "node:assert/strict";
import test from "node:test";
import { aiAnswerDisclosure, aiPublicationValidity, aiResponseCacheKey, aiSourceIssuesFor, aiSourceType, buildAIContext, createAIProvider, detectIntent, GeminiProvider, publicAISources, retrievePublications, safeAISourceUrl } from "./ai.ts";
import { usefulInformation } from "./useful-information.ts";
import type { Profile, Publication } from "./types.ts";

const base = { source: "Capacitación Docente", external_id: "1", kind: "capacitacion", category: "Capacitación", summary: "", level: "Secundario", area: "Ciencias Sociales", junta: "", location: "", shift: "", character: "", starts_at: null, ends_at: null, official_url: "https://oficial.test/1", metadata: "{}", first_seen_at: "2026-09-01", updated_at: "2026-09-26" } as Publication;
const records = [
  { ...base, id: "next", title: "Curso próximo", status: "próximamente", metadata: JSON.stringify({ registrationOpensAt: "2026-10-02T09:00:00-03:00", registrationHasTime: true, registrationClosesAt: "2026-10-10T23:59:00-03:00", dateStatus: "confirmed" }) },
  { ...base, id: "open", title: "Curso abierto", status: "inscripción abierta", metadata: JSON.stringify({ registrationOpensAt: "2026-09-30T09:00:00-03:00", registrationClosesAt: "2026-10-10T23:59:00-03:00", dateStatus: "confirmed" }) },
] as Publication[];
const trainingRecord = (id: string, source: string, registrationOpensAt: string, extra: Record<string, unknown> = {}) => ({
  ...base, id, external_id: id, source, title: `Registro ${id}`, starts_at: null, ends_at: null, status: "próximamente", source_status: "próximamente", normalized_status: "UPCOMING",
  metadata: JSON.stringify({ entity: "commission", trainingId: id, registrationOpensAt, registrationHasTime: true, preinscripcionFechaConfirmada: true, dateStatus: "confirmed", source }), ...extra,
}) as Publication;
const vacancy = { ...base, id: "vacancy", kind: "vacante", category: "Vacante", title: "Horas de Filosofía", area: "Filosofía", status: "vigente" } as Publication;
const publicDocument = { ...base, id: "comunicado", kind: "junta", category: "Comunicados", title: "Comunicado Secundaria", summary: "Presentación de documentación hasta el 30 de septiembre", status: "vigente" } as Publication;
const openCall = { ...base, id: "llamado", kind: "junta", category: "Llamados abiertos", title: "Convocatoria abierta de Inicial", status: "vigente" } as Publication;
const usefulRecords = usefulInformation.map((item) => ({ ...base, id: `info:${item.id}`, external_id: item.id, kind: "informacion", category: item.category, title: item.title, summary: item.summary, level: "", area: (item.metadata.aliases || []).join(" · "), status: "vigente", official_url: item.officialUrl, metadata: JSON.stringify(item.metadata) })) as Publication[];

test("recupera primero la próxima inscripción usando datos reales", () => assert.equal(retrievePublications("¿Qué capacitación abre primero?", records, 8, { now: new Date("2026-10-01T09:00:00-03:00") })[0]?.id, "next"));
test("una conversación general no adjunta fuentes irrelevantes", () => assert.equal(buildAIContext("Hola", records).sources.length, 0));
test("una definición de suplente no cita vacantes del panel abierto", () => {
  const result = buildAIContext("¿Qué significa suplente en una designación docente?", [...records, vacancy], { context: { type: "vacantes", title: "Designaciones" } });
  assert.equal(result.intent, "conversacion_general");
  assert.deepEqual(result.sources, []);
  assert.doesNotMatch(result.context, /Horas de Filosofía|Contexto del panel: tipo vacantes/);
});
test("recupera capacitaciones que abren próximamente", () => assert.equal(retrievePublications("¿Qué capacitaciones abren próximamente?", records, 8, { now: new Date("2026-10-01T09:00:00-03:00") })[0]?.id, "next"));
test("las consultas equivalentes de capacitaciones seleccionan por el estado y la apertura sincronizados", () => {
  const now = new Date("2026-10-01T09:00:00-03:00"), soon = trainingRecord("soon", "Capacitación Docente", "2026-10-03T10:30:00-03:00"), later = trainingRecord("later", "INFoD / AulaS-TIC", "2026-10-20T10:00:00-03:00"), openNow = trainingRecord("open-now", "CeNET / INET", "2026-09-30T10:00:00-03:00", { status: "inscripción abierta", source_status: "inscripción abierta", normalized_status: "ACTIVE", metadata: JSON.stringify({ entity: "course", trainingId: "open-now", registrationOpensAt: "2026-09-30T10:00:00-03:00", registrationClosesAt: "2026-10-10T23:59:00-03:00", dateStatus: "confirmed" }) }),
    staleText = trainingRecord("stale", "Capacitación Docente", "2026-09-01T10:00:00-03:00", { status: "inscripción abierta", source_status: "inscripción abierta", metadata: JSON.stringify({ entity: "course", trainingId: "stale", registrationOpensAt: "2026-09-01T10:00:00-03:00", registrationClosesAt: "2026-09-02T10:00:00-03:00", dateStatus: "tentative" }) });

  assert.deepEqual(buildAIContext("¿Qué capacitaciones hay próximamente?", [soon, later, openNow, staleText], { now }).sources.map((item) => item.id), ["soon", "later"]);
  assert.deepEqual(buildAIContext("¿Qué abre esta semana?", [soon, later, openNow], { now }).sources.map((item) => item.id), ["soon"]);
  assert.deepEqual(buildAIContext("¿Hay inscripciones abiertas?", [soon, openNow, staleText], { now }).sources.map((item) => item.id), ["open-now"]);
});
test("FDCI comunica la fecha y hora confirmadas de preinscripción de la comisión, no el inicio del curso", () => {
  const fdci = trainingRecord("fdci", "Capacitación Docente", "2026-10-05T14:30:00-03:00", { starts_at: "2026-11-02T00:00:00-03:00", metadata: JSON.stringify({ entity: "commission", trainingId: "fdci-course", commissionId: "fdci", registrationOpensAt: "2026-10-05T14:30:00-03:00", registrationHasTime: true, preinscripcionFechaConfirmada: true, courseStartsAt: "2026-11-02T00:00:00-03:00", dateStatus: "confirmed", source: "FDCI Tucumán" }) });
  const result = buildAIContext("¿Qué capacitaciones de FDCI abren próximamente?", [fdci], { now: new Date("2026-10-01T09:00:00-03:00") });
  assert.deepEqual(result.sources.map((item) => item.id), ["fdci"]);
  assert.match(result.context, /2026-10-05T14:30:00-03:00 \(fecha y hora informadas por la fuente\)/);
  assert.match(result.context, /Confirmación específica de apertura FDCI: sí, según la comisión oficial/);
  assert.match(result.context, /Inicio del curso: 2026-11-02T00:00:00-03:00/);
});
test("la IA recupera CeNET con fecha tentativa y la marca como prevista", () => {
  const cenet = trainingRecord("cenet", "CeNET / INET", "2026-10-08T00:00:00-03:00", { metadata: JSON.stringify({ entity: "course", trainingId: "cenet", registrationOpensAt: "2026-10-08T00:00:00-03:00", registrationClosesAt: "2026-10-18T23:59:59-03:00", dateStatus: "tentative", registrationHasTime: false, source: "CeNET / INET" }) });
  const result = buildAIContext("¿Qué capacitaciones de CeNET abren próximamente?", [cenet], { now: new Date("2026-10-01T09:00:00-03:00") });
  assert.deepEqual(result.sources.map((item) => item.id), ["cenet"]);
  assert.match(result.context, /FECHA TENTATIVA \/ PREVISTA SEGÚN LA FUENTE/);
  assert.match(result.context, /no confirma hora exacta|no informa hora exacta/i);
});
test("una consulta personalizada de capacitaciones requiere autorización explícita del perfil", () => {
  const result = buildAIContext("¿Qué capacitaciones hay para mí?", records);
  assert.equal(result.intent, "capacitaciones");
  assert.deepEqual(result.sources, []);
  assert.match(result.context, /no autorizó usar su perfil/);
  assert.match(result.context, /necesitás activar 'Usar mi perfil docente'/);
  assert.match(result.context, /No concluyas que no hay capacitaciones/);
});
test("CeNET se clasifica como búsqueda de capacitaciones aunque no diga curso", () => assert.equal(detectIntent("¿Qué hay de CeNET?"), "capacitaciones"));
test("una consulta de próximas preinscripciones FDCI no sustituye la fuente ni inventa aperturas", () => {
  const cenet = { ...records[0], id: "cenet", source: "CeNET / INET", title: "Curso con inscripción próxima", metadata: JSON.stringify({ registrationOpensAt: "2026-10-05T10:00:00-03:00", dateStatus: "confirmed", preinscripcionFechaConfirmada: true }) } as Publication;
  const unknownFdci = { ...records[0], id: "fdci-unknown", title: "Capacitación FDCI", metadata: "{}" } as Publication;
  const question = "¿Qué capacitaciones tienen apertura de preinscripción confirmada próximamente en FDCI?";
  assert.deepEqual(retrievePublications(question, [unknownFdci, cenet], 8, { now: new Date("2026-09-30T08:00:00-03:00") }), []);
  const confirmedFdci = { ...unknownFdci, id: "fdci-confirmed", metadata: JSON.stringify({ registrationOpensAt: "2026-10-05T10:00:00-03:00", registrationHasTime: true, dateStatus: "confirmed", preinscripcionFechaConfirmada: true }) } as Publication;
  assert.deepEqual(retrievePublications(question, [unknownFdci, cenet, confirmedFdci], 8, { now: new Date("2026-09-30T08:00:00-03:00") }).map((item) => item.id), ["fdci-confirmed"]);
});
test("no agrega el perfil al contexto sin autorización", () => assert.match(buildAIContext("capacitaciones", records).context, /no autorizó usar su perfil/));

const profile = { user_id: "u", name: "Docente", level: "Secundario", levels: ["Secundario"], area: "Ciencias Sociales, Filosofía", areas: ["Ciencias Sociales", "Filosofía"], subjects: [], junta: "", boards: [], roles: [], department: "", locality: "", shifts: [], characters: [], circuits: [], personal_match_threshold: 85, training_match_threshold: 80, wants_interim: true, wants_substitute: true, training_interests: ["Ciencias Sociales"], notify_new_trainings: false, training_notify_scope: "relevant" } as Profile;

test("la clave de caché de IA queda aislada por cuenta o instalación", () => {
  assert.notEqual(aiResponseCacheKey("cuenta-a", "capacitaciones", "¿Qué abre?", "2026-10-06"), aiResponseCacheKey("cuenta-b", "capacitaciones", "¿Qué abre?", "2026-10-06"));
});

test("usa el matching real y conserva su porcentaje", () => {
  const result = buildAIContext("¿Qué capacitaciones coinciden con mi perfil?", records, { profile, now: new Date("2026-10-01T09:00:00-03:00") });
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
  assert.equal(detectIntent("Buscá un padrón docente"), "junta");
  assert.equal(detectIntent("¿Qué comunicados recientes hay para Nivel Superior?"), "junta");
  assert.equal(detectIntent("Me liquidaron mal el sueldo"), "informacion");
  assert.equal(detectIntent("Tengo que faltar mañana, ¿qué debo presentar?"), "inasistencia");
  assert.equal(detectIntent("¿Cómo hago para presentar una licencia?"), "licencias");
  assert.equal(detectIntent("¿Hay designaciones compatibles conmigo?"), "designaciones");
  assert.equal(detectIntent("¿Qué capacitaciones tengo disponibles?"), "capacitaciones");
  assert.equal(detectIntent("¿Qué tengo hoy en mi agenda?"), "agenda");
  assert.equal(detectIntent("¿Cómo uso esta aplicación DocenteTuc?"), "app");
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
  assert.equal(buildAIContext("Tengo que faltar mañana, ¿qué debo presentar?", usefulRecords).sources[0]?.id, "info:licencias");
  assert.equal(buildAIContext("¿Cómo hago para presentar una licencia?", usefulRecords).sources[0]?.id, "info:licencias");
  assert.match(buildAIContext("Tengo problemas con mi certificado FDCI", usefulRecords).context, /no publicado/);
});

test("agenda personal recupera eventos manuales de la fecha consultada", () => {
  const result = buildAIContext("¿Qué tengo hoy en mi agenda?", [], { now: new Date("2026-09-29T10:00:00-03:00"), agendaEntries: [
    { id: "manual:today", title: "Reunión de padres", category: "Escuela", startsAt: "2026-09-29T18:30:00-03:00", kind: "manual" },
    { id: "manual:tomorrow", title: "Entrega de planificaciones", category: "Escuela", startsAt: "2026-09-30T09:00:00-03:00", kind: "manual" },
  ] });
  assert.match(result.context, /Reunión de padres/);
  assert.doesNotMatch(result.context, /Entrega de planificaciones/);
  assert.equal(result.sources[0]?.sourceType, "personal");
  assert.equal(result.sources[0]?.source, "Tu agenda");
});

test("con una fuente oficial caída mantiene el contexto y permite responder con el proveedor", async () => {
  const context = buildAIContext("Tengo que faltar mañana, ¿qué debo presentar?", usefulRecords, { sourceFailures: ["Información oficial Tucumán"] });
  assert.deepEqual(context.sources.map((source) => source.id), ["info:licencias"]);
  assert.match(context.context, /falló la última actualización de Información oficial Tucumán/);
  assert.match(context.context, /orientación general/);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ candidates: [{ content: { parts: [{ text: "Para orientarte necesito saber el motivo de la inasistencia." }] } }] });
  try {
    const answer = await new GeminiProvider("secret-test", "gemini-3.5-flash-lite").generate(`PREGUNTA: Tengo que faltar mañana.\n${context.context}`, "Respondé aunque una fuente haya fallado; no inventes requisitos.");
    assert.match(answer, /motivo de la inasistencia/);
  } finally { globalThis.fetch = originalFetch; }
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
  assert.match(result.context, /No se recuperaron evidencias públicas suficientes/);
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
test("un registro SIME etiquetado abierto no se presenta como llamado presencial de Junta", () => {
  const simeOpen = { ...vacancy, id: "sime-open", source: "SIME", category: "Llamado abierto", title: "Vacante SIME para inscripción" } as Publication;
  assert.deepEqual(retrievePublications("¿Qué llamados abiertos hay?", [simeOpen, openCall]).map((item) => item.id), ["llamado"]);
});
test("comunicados recientes no mezclan capacitaciones ni padrones y advierten una verificación fallida", () => {
  const result = buildAIContext("¿Qué comunicados recientes hay para Nivel Superior?", [publicDocument, openCall, ...records], { sourceFailures: ["Comunicados"] });
  assert.deepEqual(result.sources.map((source) => source.id), ["comunicado"]);
  assert.match(result.context, /No afirmes que esa fuente fue consultada o verificada hoy/);
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

test("la procedencia oficial conserva nombre y enlace HTTPS, pero no expone el ID interno", () => {
  const source = { ...vacancy, id: "internal-publication-id-should-not-leak", source: "SIME", title: "Designaciones de Filosofía", official_url: "https://sime.educaciontuc.gov.ar/Vacantes/Detalle/1" };
  const result = buildAIContext("¿Qué designaciones de Filosofía hay?", [source]);
  assert.equal(result.sources[0]?.source, "SIME");
  assert.equal(result.sources[0]?.sourceType, "official");
  assert.equal(result.sources[0]?.url, "https://sime.educaciontuc.gov.ar/Vacantes/Detalle/1");
  assert.doesNotMatch(result.context, /internal-publication-id-should-not-leak/);
  assert.deepEqual(publicAISources(result.sources), [{ title: "Designaciones de Filosofía", source: "SIME", sourceType: "official", url: "https://sime.educaciontuc.gov.ar/Vacantes/Detalle/1", publishedAt: null, relevantAt: null, registrationOpenAt: null, registrationCloseAt: null, validity: "UNKNOWN" }]);
  assert.deepEqual(safeAISourceUrl("javascript:alert(1)"), "");
  assert.deepEqual(safeAISourceUrl("http://sime.educaciontuc.gov.ar/"), "");
  assert.deepEqual(safeAISourceUrl("https://usuario:clave@oficial.test/"), "");
});

test("citas conservan publicación, fechas y vigencia sin confundir sincronización con publicación", () => {
  const record = { ...vacancy, source_published_at: "2026-09-20", updated_at: "2026-10-10", starts_at: "2026-09-21", ends_at: "2026-09-30", normalized_status: "ACTIVE" } as Publication;
  const result = buildAIContext("¿Qué designaciones de Filosofía vencidas hubo?", [record], { now: new Date("2026-10-14T12:00:00Z") });
  assert.equal(aiPublicationValidity(record, new Date("2026-10-14T12:00:00Z")), "EXPIRED");
  assert.equal(result.sources[0]?.validity, "EXPIRED");
  assert.equal(result.sources[0]?.publishedAt, "2026-09-20");
  assert.equal(result.sources[0]?.relevantAt, "2026-09-21");
  assert.match(result.context, /Vigencia calculada: EXPIRED/);
  assert.match(result.context, /Fecha de sincronización no equivale a fecha de publicación/);
});

test("no recomienda como vigentes designaciones expiradas, pero admite una consulta histórica", () => {
  const old = { ...vacancy, ends_at: "2026-09-30", normalized_status: "ACTIVE" } as Publication;
  const now = new Date("2026-10-14T12:00:00Z");
  assert.deepEqual(retrievePublications("¿Qué designaciones de Filosofía hay?", [old], 8, { now }), []);
  assert.deepEqual(retrievePublications("¿Qué designaciones de Filosofía vencidas hubo?", [old], 8, { now }).map((item) => item.id), ["vacancy"]);
});

test("fuentes no conocidas nunca se atribuyen automáticamente a un organismo oficial", () => {
  assert.equal(aiSourceType("SIME"), "official");
  assert.equal(aiSourceType("Publicación pública futura"), "public");
  const result = buildAIContext("¿Qué comunicado pide documentación?", [{ ...publicDocument, source: "Publicación pública futura" }]);
  assert.equal(result.sources[0]?.sourceType, "public");
  assert.equal(aiAnswerDisclosure(result.sources, [], result.intent).label, "Información pública en DocenteTuc");
  assert.match(result.context, /inferencias de IA/);
});

test("contexto del proveedor limita un documento extenso y notas personales", () => {
  const document = { ...publicDocument, summary: "X".repeat(8000) } as Publication;
  const result = buildAIContext("¿Qué comunicado hay?", [document]);
  assert.ok(result.context.length < 5000);
  assert.doesNotMatch(result.context, /X{1300}/);
});

test("una fuente que falló no se confunde con una sincronización correcta sin resultados", () => {
  const question = "¿Qué vacantes hay?";
  const failed = aiSourceIssuesFor("vacantes", [{ source: "SIME", sync_status: "DNS_ERROR" }], question);
  const healthyEmpty = aiSourceIssuesFor("vacantes", [{ source: "SIME", sync_status: "OK" }], question);
  const unverified = aiSourceIssuesFor("vacantes", [], question);
  assert.deepEqual(failed, [{ source: "SIME", state: "unavailable" }]);
  assert.deepEqual(healthyEmpty, []);
  assert.deepEqual(unverified, [{ source: "SIME", state: "unverified" }]);
  assert.equal(aiAnswerDisclosure([], failed, "vacantes").kind, "unavailable");
  assert.match(aiAnswerDisclosure([], failed, "vacantes").detail, /quizá no refleje novedades/);
  assert.equal(aiAnswerDisclosure([], healthyEmpty, "vacantes").kind, "general");
  assert.match(aiAnswerDisclosure([], healthyEmpty, "vacantes").detail, /no confirma datos actuales/);
  assert.equal(aiAnswerDisclosure([], unverified, "vacantes").kind, "unverified");
});

test("CENDIE no hereda el fallo ni la falta de verificación de SIME", () => {
  const question = "¿Dónde consulto CENDIE?";
  const intent = detectIntent(question);
  const issues = aiSourceIssuesFor(intent, [{ source: "SIME", sync_status: "NETWORK_ERROR" }, { source: "Información oficial Tucumán", sync_status: "OK" }], question);
  assert.deepEqual(issues, []);
  const context = buildAIContext(question, usefulRecords, { sourceFailures: ["SIME"], sourceNotVerified: ["SIME"] });
  assert.ok(context.sources.some((source) => source.id === "info:cendie"));
  assert.doesNotMatch(context.context, /actualización de SIME|registrada para SIME/);
  assert.notEqual(aiAnswerDisclosure(context.sources, issues, intent).kind, "unavailable");
});

test("las consultas SIME mantienen el aviso pertinente aunque no haya registros", () => {
  for (const question of ["¿Qué designaciones SIME hay?", "¿Dónde ingreso a SIME?"]) {
    const intent = detectIntent(question);
    const issues = aiSourceIssuesFor(intent, [{ source: "SIME", sync_status: "NETWORK_ERROR" }], question);
    assert.ok(issues.some((issue) => issue.source === "SIME" && issue.state === "unavailable"));
    assert.match(buildAIContext(question, [], { sourceFailures: ["SIME"] }).context, /falló la última actualización de SIME/);
    assert.equal(aiAnswerDisclosure([], issues, intent).kind, "unavailable");
  }
});

test("la orientación general nunca se etiqueta como información oficial", () => {
  const result = buildAIContext("¿Qué significa ser suplente?", []);
  const disclosure = aiAnswerDisclosure(result.sources, [], result.intent);
  assert.equal(disclosure.kind, "general");
  assert.equal(disclosure.label, "Orientación general de IA");
  assert.match(result.context, /no atribuyas datos actuales a fuentes oficiales/);
});

test("distingue una respuesta que mezcla fuentes oficiales con agenda personal", () => {
  const disclosure = aiAnswerDisclosure([{ sourceType: "official" }, { sourceType: "personal" }], [], "agenda");
  assert.equal(disclosure.kind, "mixed");
  assert.match(disclosure.label, /Fuentes públicas \+ datos personales/);
  assert.match(disclosure.detail, /no son información oficial/);
});

test("el prompt minimiza identidad privada incluso con el perfil autorizado", () => {
  const privateProfile = { ...profile, name: "NOMBRE_PRIVADO_TEST", user_id: "CUENTA_PRIVADA_TEST", email: "MAIL_PRIVADO_TEST", image: "FOTO_PRIVADA_TEST" } as Profile;
  const result = buildAIContext("¿Qué vacantes coinciden conmigo?", [{ ...vacancy, circuit: "II" }], { profile: { ...privateProfile, circuits: ["II"] } });
  assert.match(result.context, /Perfil autorizado: niveles Secundario/);
  assert.doesNotMatch(result.context, /NOMBRE_PRIVADO_TEST|CUENTA_PRIVADA_TEST|MAIL_PRIVADO_TEST|FOTO_PRIVADA_TEST/);
  assert.doesNotMatch(result.context, /installationId|Google ID|OAuth|token/i);
});

test("OpenAI recibe consulta y contexto sin colocar la clave en URL o cuerpo", async () => {
  const originalFetch = globalThis.fetch;
  let requestUrl = "", requestInit: RequestInit | undefined;
  globalThis.fetch = async (input, init) => { requestUrl = String(input); requestInit = init; return Response.json({ output_text: "Respuesta de prueba" }); };
  try {
    assert.equal(await createAIProvider({ provider: "openai", apiKey: "secret-test", model: "test-model" }).generate("Consulta", "Instrucciones"), "Respuesta de prueba");
    assert.equal(requestUrl, "https://api.openai.com/v1/responses");
    assert.doesNotMatch(requestUrl, /secret-test/);
    assert.doesNotMatch(String(requestInit?.body), /secret-test/);
    assert.equal((requestInit?.headers as Record<string, string>).Authorization, "Bearer secret-test");
    assert.match(String(requestInit?.body), /"store":false/);
  } finally { globalThis.fetch = originalFetch; }
});
