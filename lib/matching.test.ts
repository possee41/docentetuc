import assert from "node:assert/strict";
import test from "node:test";
import { isEligibleForPersonalizedHome, isEligibleMatchResult, matchScore, matchesProfile, profileMatch } from "./matching.ts";

const profile = { level: "Secundario", area: "Ciencias Sociales", subjects: "Construcción de Ciudadanía", locality: "Capital", shifts: "Mañana", wantsInterim: false, wantsSubstitute: true };
const exact = { kind: "vacante", title: "3 hs. Construcción de Ciudadanía", summary: "Escuela secundaria de Capital", level: "Secundario", shift: "Mañana", character: "Suplente" };

test("sólo considera exacta una publicación que cumple todos los criterios configurados", () => {
  const result = profileMatch(exact, profile);
  assert.equal(result.status, "exact");
  assert.equal(result.score, 100);
  assert.equal(matchesProfile(exact, profile), true);
});

test("no penaliza un criterio ausente y lo conserva como desconocido", () => {
  const result = profileMatch({ ...exact, summary: "" }, profile);
  assert.equal(result.status, "exact");
  assert.ok(result.criteria.some((criterion) => criterion.key === "location" && !criterion.matched));
  assert.ok(result.criteria.some((criterion) => criterion.key === "location" && !criterion.available));
  assert.equal(result.score, 100);
});

test("devuelve UNKNOWN cuando la fuente no aporta evidencia evaluable", () => {
  const result = profileMatch({ kind: "capacitacion", title: "Curso sin destinatarios ni área" }, { shifts: ["Mañana"] });
  assert.equal(result.status, "unknown");
  assert.equal(result.confidence, 0);
  assert.equal(matchesProfile({ kind: "capacitacion", title: "Curso sin destinatarios ni área" }, { shifts: ["Mañana"] }), false);
});

test("una coincidencia parcial con incompatibilidades explícitas no se etiqueta MATCH", () => {
  const result = profileMatch({
    kind: "vacante",
    title: "Instituto - Administración y Estructura Empresaria",
    level: "Superior",
    area: "Administración",
    junta: "Superior",
    shift: "Noche",
    character: "Suplente",
  }, {
    levels: ["Secundario", "Superior"],
    areas: ["Ciencias Sociales", "Filosofía", "Psicología"],
    boards: ["Secundaria"],
    locality: "San Miguel de Tucumán",
    shifts: ["Mañana", "Tarde", "Noche"],
    wantsSubstitute: true,
  });
  assert.equal(result.score, 50);
  assert.equal(result.confidence, 80);
  assert.equal(result.outcome, "NO_MATCH");
});

test("no recomienda resultados que sólo coinciden débilmente", () => {
  const unrelated = { kind: "vacante", title: "Maestro de grado", summary: "Escuela primaria de Monteros", level: "Primario", shift: "Tarde", character: "Interino" };
  assert.equal(profileMatch(unrelated, profile).status, "none");
  assert.equal(matchesProfile(unrelated, profile), false);
  assert.ok(matchScore(exact, profile) > matchScore(unrelated, profile));
});

test("una preferencia de carácter deshabilitada impide la coincidencia exacta", () => {
  const result = profileMatch({ ...exact, character: "Interino" }, profile);
  assert.equal(result.status, "partial");
  assert.equal(result.criteria.find((criterion) => criterion.key === "character")?.matched, false);
});

test("un perfil multinivel coincide con cualquiera de sus niveles", () => {
  const multi = { levels: ["Secundario", "Superior"] };
  assert.equal(profileMatch({ kind: "vacante", title: "Cargo", level: "Secundario" }, multi).criteria[0]?.matched, true);
  assert.equal(profileMatch({ kind: "vacante", title: "Cargo", level: "Superior" }, multi).criteria[0]?.matched, true);
  assert.equal(profileMatch({ kind: "vacante", title: "Cargo", level: "Primario" }, multi).criteria[0]?.matched, false);
});

test("un perfil Inicial y Secundario coincide con ambos, no con Primario", () => {
  const multi = { levels: ["Inicial", "Secundario"] };
  assert.equal(profileMatch({ kind: "capacitacion", title: "Curso", level: "Inicial" }, multi).criteria[0]?.matched, true);
  assert.equal(profileMatch({ kind: "capacitacion", title: "Curso", level: "Secundario" }, multi).criteria[0]?.matched, true);
  assert.equal(profileMatch({ kind: "capacitacion", title: "Curso", level: "Primario" }, multi).criteria[0]?.matched, false);
});

test("múltiples áreas y materias coinciden por al menos una selección", () => {
  const multi = { areas: ["Psicología", "Ciencias Sociales"], subjects: ["Construcción de Ciudadanía"] };
  assert.equal(profileMatch({ kind: "capacitacion", title: "Ciudadanía digital", area: "Construcción de Ciudadanía" }, multi).criteria[0]?.matched, true);
  assert.equal(profileMatch({ kind: "capacitacion", title: "Matemática", area: "Matemática" }, multi).criteria[0]?.matched, false);
});

test("una designación considera varios cargos de interés sin aceptar una coincidencia débil", () => {
  const result = profileMatch({ kind: "vacante", title: "Escuela X - Profesor de Psicología", level: "Secundaria", area: "Psicología" }, { levels: ["Secundaria"], areas: ["Ciencias Sociales"], subjects: ["Psicología"], roles: ["Preceptor", "Profesor"] });
  assert.equal(result.criteria.find((item) => item.key === "role")?.matched, true);
  assert.equal(result.status, "exact");
  const weak = profileMatch({ kind: "vacante", title: "Profesor", level: "Primaria", area: "Matemática" }, { levels: ["Secundaria"], subjects: ["Psicología"], roles: ["Profesor"] });
  assert.equal(weak.status, "partial");
  assert.ok(weak.score < 50);
});

test("un mismo nivel, área y circuito produce coincidencia con evidencia suficiente", () => {
  const profile = { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II"] };
  const result = profileMatch({ kind: "capacitacion", title: "Curso de Ciencias Sociales", level: "Secundario", area: "Ciencias Sociales", circuit: "II" }, profile);
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 100);
  assert.equal(result.outcome, "MATCH");
  assert.equal(isEligibleForPersonalizedHome({ kind: "capacitacion", title: "Curso de Ciencias Sociales", level: "Secundario", area: "Ciencias Sociales", circuit: "II" }, profile), true);
});

test("el mismo nivel no tapa un área incompatible", () => {
  const result = profileMatch({ kind: "capacitacion", title: "Matemática", level: "Secundario", area: "Matemática" }, { levels: ["Secundario"], areas: ["Ciencias Sociales"] });
  assert.equal(result.score, 50);
  assert.equal(result.confidence, 100);
  assert.equal(result.outcome, "NO_MATCH");
});

test("una incompatibilidad de circuito impide un falso 100%", () => {
  const result = profileMatch({ kind: "capacitacion", title: "Curso", level: "Secundario", area: "Ciencias Sociales", circuit: "V" }, { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II"] });
  assert.equal(result.score, 67);
  assert.equal(result.outcome, "NO_MATCH");
  assert.equal(isEligibleMatchResult(result, 85), false);
});

test("circuito desconocido no reduce compatibilidad, pero sí la confianza", () => {
  const result = profileMatch({ kind: "capacitacion", title: "Curso", level: "Secundario", area: "Ciencias Sociales" }, { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II"] });
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 67);
  assert.equal(result.outcome, "UNKNOWN");
});

test("turno desconocido no resta compatibilidad, pero baja confianza", () => {
  const result = profileMatch({ kind: "capacitacion", title: "Curso", level: "Secundario", area: "Ciencias Sociales" }, { levels: ["Secundario"], areas: ["Ciencias Sociales"], shifts: ["Mañana"] });
  assert.equal(result.score, 100);
  assert.equal(result.criteria.find((item) => item.key === "shift")?.outcome, "UNKNOWN");
  assert.equal(result.confidence, 67);
});

test("acepta varios circuitos elegidos y ofertas explícitamente provinciales", () => {
  const profile = { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II", "III"] };
  assert.equal(profileMatch({ kind: "capacitacion", title: "Curso", level: "Secundario", area: "Ciencias Sociales", circuit: "III" }, profile).criteria.find((item) => item.key === "circuit")?.outcome, "MATCH");
  assert.equal(profileMatch({ kind: "capacitacion", title: "Curso", level: "Secundario", area: "Ciencias Sociales", circuit: "ALL" }, profile).criteria.find((item) => item.key === "circuit")?.outcome, "MATCH");
});

test("una sola coincidencia de nivel no es evidencia suficiente para recomendar 100%", () => {
  const publication = { kind: "capacitacion", title: "Programación Creativa con Scratch en la Escuela Secundaria", level: "Secundario" };
  const result = profileMatch(publication, { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II"] });
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 33);
  assert.equal(result.status, "unknown");
  assert.equal(isEligibleForPersonalizedHome(publication, { levels: ["Secundario"], areas: ["Ciencias Sociales"], circuits: ["II"] }), false);
});

test("una designación con sólo dos datos conocidos no muestra una compatibilidad confirmada", () => {
  const publication = { kind: "vacante", title: "Escuela Secundaria - Filosofía", level: "Secundario", area: "Filosofía" };
  const profile = { boards: ["Secundaria"], subjects: ["Filosofía"] };
  const result = profileMatch(publication, profile);
  assert.equal(result.score, 100);
  assert.equal(result.confidence, 67);
  assert.equal(result.status, "unknown");
  assert.equal(isEligibleForPersonalizedHome(publication, profile), false);
});

test("el umbral personal para Inicio se aplica junto con la confianza", () => {
  const good: Parameters<typeof isEligibleMatchResult>[0] = { status: "exact", outcome: "MATCH", score: 85, compatibility: 85, compatibilityScore: 85, confidence: 85, matchConfidence: 85, matched: 6, total: 7, reasons: [], criteria: [] };
  assert.equal(isEligibleMatchResult(good, 85), true);
  assert.equal(isEligibleMatchResult(good, 90), false);
  assert.equal(isEligibleMatchResult({ ...good, confidence: 69 }, 70), false);
});
