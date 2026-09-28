import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isCenetMarkupRecognized, parseCenetTrainings, parseInfdCatalog, parseInfdTrainings } from "./external-trainings.ts";

test("CeNET reconoce y recupera el HTML de fixture guardado", async () => {
  const html = await readFile(new URL("./fixtures/cenet-cohort-sample.html", import.meta.url), "utf8");
  assert.equal(isCenetMarkupRecognized(html), true);
  assert.equal(isCenetMarkupRecognized("<html><body>Error</body></html>"), false);
  const [course] = parseCenetTrainings(html, new Date("2026-09-27T12:00:00-03:00"));
  assert.equal(course.metadata.registrationOpensAt, "2026-10-05T00:00:00-03:00");
  assert.equal(course.metadata.registrationClosesAt, "2026-10-12T23:59:59-03:00");
  assert.equal(course.metadata.courseStartsAt, "2026-11-02T00:00:00-03:00");
  assert.equal(course.metadata.courseEndsAt, "2026-12-09T23:59:59-03:00");
  assert.equal(course.metadata.dateStatus, "tentative");
});

test("INFoD keeps the general catalogue window separate from per-course dates", () => {
  const catalog = parseInfdCatalog('<p>Fecha de inscripción: <strong>14 de agosto al 26 de agosto</strong><br>Inicio de cursado: <strong>semana del 14 de septiembre</strong></p><a href="https://red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/">Cursos</a>', new Date("2026-09-01T12:00:00-03:00"));
  const courses = parseInfdTrainings('<p><strong>Destinatarios: Docentes de nivel inicial y primario.</strong></p><p style="font-size:30px"><strong>Alfabetización temprana</strong></p><p>Curso autoasistido. INICIO: 14/09</p>', catalog.pages[0], catalog, new Date("2026-08-20T12:00:00-03:00"));
  assert.equal(catalog.registrationOpensAt, "2026-08-14T00:00:00-03:00");
  assert.equal(courses.length, 1);
  assert.equal(courses[0].status, "consultar");
  assert.equal(courses[0].metadata.source, "INFoD / AulaS-TIC");
  assert.equal(courses[0].metadata.registrationOpensAt, undefined);
  assert.equal(courses[0].metadata.generalWindowOpensAt, "2026-08-14T00:00:00-03:00");
  assert.equal(courses[0].metadata.dateStatus, "general_window");
});

  test("INFoD marks a course-specific start without borrowing the general enrollment window", () => {
  const catalog = parseInfdCatalog('<p>Fecha de inscripción: <strong>14 de agosto al 26 de agosto</strong></p><a href="https://red.infd.edu.ar/curso-docente/">Curso</a>', new Date("2026-09-01T12:00:00-03:00"));
  const [course] = parseInfdTrainings('<p style="font-size:30px"><strong>Curso con inicio publicado</strong></p><p>Comienza el curso: 20/10/2026</p>', catalog.pages[0], catalog, new Date("2026-09-01T12:00:00-03:00"));
  assert.equal(course.metadata.courseStartsAt, "2026-10-20T00:00:00-03:00");
  assert.equal(course.metadata.registrationOpensAt, undefined);
    assert.equal(course.metadata.generalWindowOpensAt, "2026-08-14T00:00:00-03:00");
    assert.equal(course.metadata.dateStatus, "course_confirmed");
    assert.equal(course.status, "consultar", "a future course start is not evidence that enrollment is open or upcoming");
  });
