import test from "node:test";
import assert from "node:assert/strict";
import { parseCenetTrainings, parseInfdCatalog, parseInfdTrainings } from "./external-trainings.ts";

test("CeNET recupera cursos y la cohorte 6 tentativa desde el HTML público", () => {
  const cells = (label: string, values: string[]) => `<div>${label}</div>${values.map((value) => `<div>${value}</div>`).join("")}`;
  const html = `Calendario de cohortes 2026 ${cells("Inicio preinscripción", ["09-feb", "30-mar", "18-may", "29-jun", "24-ago", "05-oct"])}${cells("Fin preinscripción", ["16-feb", "06-abr", "26-may", "08-jul", "02-sep", "12-oct"])}${cells("Inicio de cohorte", ["23-feb-26", "13-abr-26", "01-jun-26", "27-jul-26", "14-sep-26", "02-nov-26"])}${cells("Fin de cohorte", ["06-abr-26", "25-may-26", "13-jul-26", "07-sep-26", "26-oct-26", "09-dic-26"])}<p>Fechas tentativas</p><button onclick="cnetPop(this)" data-slug="ia" data-t="IA para docentes" data-f="Informática" data-n="Secundario" data-d="Docentes ETP" data-s="Curso público" data-i="https://example.test/inscripcion">Más información</button>`;
  const [course] = parseCenetTrainings(html, new Date("2026-09-27T12:00:00-03:00"));
  assert.equal(course.metadata.registrationOpensAt, "2026-10-05T00:00:00-03:00");
  assert.equal(course.metadata.registrationClosesAt, "2026-10-12T23:59:59-03:00");
  assert.equal(course.metadata.courseStartsAt, "2026-11-02T00:00:00-03:00");
  assert.equal(course.metadata.courseEndsAt, "2026-12-09T23:59:59-03:00");
  assert.equal(course.metadata.dateStatus, "tentative");
});

test("INFoD recupera ventana, curso y metadata pública", () => {
  const catalog = parseInfdCatalog('<p>Fecha de inscripción: <strong>14 de agosto al 26 de agosto</strong><br>Inicio de cursado: <strong>semana del 14 de septiembre</strong></p><a href="https://red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/">Cursos</a>', new Date("2026-09-01T12:00:00-03:00"));
  const courses = parseInfdTrainings('<p><strong>Destinatarios: Docentes de nivel inicial y primario.</strong></p><p style="font-size:30px"><strong>Alfabetización temprana</strong></p><p>Curso autoasistido. INICIO: 14/09</p>', catalog.pages[0], catalog, new Date("2026-08-20T12:00:00-03:00"));
  assert.equal(catalog.registrationOpensAt, "2026-08-14T00:00:00-03:00");
  assert.equal(courses.length, 1);
  assert.equal(courses[0].status, "inscripción abierta");
  assert.equal(courses[0].metadata.source, "INFoD / AulaS-TIC");
});
