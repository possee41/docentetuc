import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { isCenetMarkupRecognized, isHistoricalCenetOffer, parseCenetTrainings, parseInfdCatalog, parseInfdTrainings, parseInfdWebinars } from "./external-trainings.ts";

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
  assert.equal(course.metadata.cohort, 6);
  assert.equal(course.metadata.category, "Innovación y entornos digitales");
  assert.equal(course.metadata.registrationUrl, "https://forms.cloud.microsoft/r/HW4irTHEs1");
});

test("CeNET cambia de cohorte y fecha cuando cambia el calendario oficial", async () => {
  const html = await readFile(new URL("./fixtures/cenet-cohort-sample.html", import.meta.url), "utf8");
  assert.equal(parseCenetTrainings(html.replace("6ta cohorte", "5ta cohorte"), new Date("2026-08-30T12:00:00-03:00"))[0].metadata.registrationOpensAt, "2026-08-24T00:00:00-03:00");
  assert.equal(parseCenetTrainings(html, new Date("2026-09-03T12:00:00-03:00"))[0].metadata.registrationOpensAt, "2026-10-05T00:00:00-03:00");
  assert.equal(parseCenetTrainings(html.replace("05-oct", "06-oct"), new Date("2026-09-03T12:00:00-03:00"))[0].metadata.registrationOpensAt, "2026-10-06T00:00:00-03:00");
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
  assert.equal(courses[0].metadata.dateStatus, "course_confirmed");
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

test("INFoD no mezcla el resumen ni las fechas del curso siguiente", () => {
  const catalog = parseInfdCatalog('<a href="https://red.infd.edu.ar/curso-docente/">Curso</a>', new Date("2026-09-30T12:00:00-03:00"));
  const html = '<p style="font-size:30px"><strong>Primer curso</strong></p><p>Descripción del primero.</p><p style="font-size:30px"><strong>Segundo curso</strong></p><p>Descripción del segundo. Fecha de inscripción: 10/10/2026 al 20/10/2026</p>';
  const [first, second] = parseInfdTrainings(html, catalog.pages[0], catalog);
  assert.equal(first.summary, "Descripción del primero.");
  assert.equal(first.metadata.registrationOpensAt, undefined);
  assert.equal(second.metadata.registrationOpensAt, "2026-10-10T00:00:00-03:00");
  assert.equal(second.summary.includes("<p"), false);
});

test("INFoD respeta una inscripción explícitamente cerrada aun sin fecha publicada", () => {
  const catalog = parseInfdCatalog('<a href="https://red.infd.edu.ar/curso-docente/">Curso</a>');
  const [course] = parseInfdTrainings('<p style="font-size:30px"><strong>Curso cerrado</strong></p><p>Inscripción cerrada</p><p>Descripción del curso.</p>', catalog.pages[0], catalog);
  assert.equal(course.status, "inscripción cerrada");
  assert.equal(course.metadata.registrationOpensAt, undefined);
});

test("INFoD descubre cursos y webinarios desde el menú oficial, sin whitelist de slugs", () => {
  const html = '<a href="https://red.infd.edu.ar/cursos-nacionales-2/">CURSOS</a><ul class="sub-menu"><li><a href="/cursos-plan-nacional-de-alfabetizacion/">Alfabetización</a></li><li><a href="/webinarios/">Webinarios</a></li></ul><a href="/noticias/">NOTICIAS</a>';
  assert.deepEqual(parseInfdCatalog(html, new Date("2026-10-11T12:00:00-03:00")).pages, [
    "https://red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/", "https://red.infd.edu.ar/webinarios/",
  ]);
});

test("INFoD extrae cursos individuales de la convocatoria real, su ventana común y sus datos", () => {
  // Fragmento estructural de la página oficial 2026: red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/
  const page = '<h1>Plan Nacional de Alfabetización 2026</h1><p>Fecha de inscripción: 14 de agosto al 26 de agosto</p><p>Es un único formulario de inscripción para todos los cursos.</p><p class="has-large-font-size"><strong>Listado de cursos</strong></p>'
    + '<p style="font-size:30px"><strong>La importancia de narraciones y cuentos para la alfabetización temprana</strong></p><p>Destinatarios: Docentes de nivel inicial.</p><p>INICIO: 14/09<br>Duración: 4 clases (4 semanas)<br>Se certifican 40 horas</p>'
    + '<p style="font-size:30px"><strong>La conversación en el nivel inicial. Mucho más que hablar y escuchar</strong></p><p>INICIO: 14/09<br>Duración: 4 clases (4 semanas)<br>Se certifican 40 horas</p>'
    + '<a href="https://postitulos.conectarigualdad.edu.ar/inscripcion"><strong>ACCESO AL FORMULARIO DE INSCRIPCIÓN</strong></a>';
  const catalog = parseInfdCatalog('<p>Fecha de inscripción: 14 de agosto al 26 de agosto</p>', new Date("2026-08-10T12:00:00-03:00"));
  const url = "https://red.infd.edu.ar/cursos-plan-nacional-de-alfabetizacion/";
  const open = parseInfdTrainings(page, url, catalog, new Date("2026-08-20T12:00:00-03:00"));
  assert.equal(open.length, 2);
  assert.equal(open[0].status, "inscripción abierta");
  assert.equal(open[0].metadata.category, "Plan Nacional de Alfabetización");
  assert.equal(open[0].metadata.certifiedHours, "40 horas");
  assert.equal(open[0].metadata.duration, "4 clases (4 semanas)");
  assert.equal(open[0].metadata.registrationOpensAt, "2026-08-14T00:00:00-03:00");
  assert.equal(open[0].metadata.registrationUrl, "https://postitulos.conectarigualdad.edu.ar/inscripcion");
  assert.equal(open[1].metadata.courseStartsAt, "2026-09-14T00:00:00-03:00");
  assert.equal(parseInfdTrainings(page, url, catalog, new Date("2026-10-01T12:00:00-03:00"))[0].status, "en curso");
  assert.equal(parseInfdTrainings(page, url, catalog, new Date("2026-11-01T12:00:00-03:00"))[0].status, "finalizada");
});

test("INFoD conserva el cierre individual distinto de la ventana general", () => {
  const catalog = parseInfdCatalog('<p>Fecha de inscripción: 14 de agosto al 26 de agosto</p>', new Date("2026-08-10T12:00:00-03:00"));
  const html = '<h1>Programa Nacional de Matemática 2026</h1><p>Es un único formulario de inscripción para todos los cursos.</p><h4>Listado de cursos</h4><p style="font-size:26px"><strong>La enseñanza de la matemática en la transición de primaria a la secundaria</strong></p><p>Inscripción abierta hasta el 14/09</p><p>INICIO: 18/09</p>';
  const [course] = parseInfdTrainings(html, "https://red.infd.edu.ar/programa-nacional-de-fortalecimiento-de-matematica-2026/", catalog, new Date("2026-09-01T12:00:00-03:00"));
  assert.equal(course.metadata.registrationClosesAt, "2026-09-14T23:59:59-03:00");
  assert.equal(course.metadata.generalWindowClosesAt, "2026-08-26T23:59:59-03:00");
});

test("Webinarios INFoD usan su fecha y enlace propios, nunca la inscripción nacional", () => {
  const html = '<h1>Webinarios 2026</h1><div class="wp-block-columns is-layout-flex"><div><p><strong><strong>30 de octubre, 14 h</strong></strong>: Ajedrez y Go en las escuelas: Estrategias para su práctica</p></div><div><a href="https://aulastic.infd.edu.ar/catalogo.cgi?wAccion=oferta_view&amp;oferta_id=751">Inscripción</a></div></div>';
  const [webinar] = parseInfdWebinars(html, "https://red.infd.edu.ar/webinarios/", new Date("2026-10-11T12:00:00-03:00"));
  assert.equal(webinar.metadata.category, "Webinarios INFoD");
  assert.equal(webinar.metadata.courseStartsAt, "2026-10-30T14:00:00-03:00");
  assert.equal(webinar.metadata.registrationOpensAt, undefined);
  assert.equal(webinar.metadata.registrationUrl, "https://aulastic.infd.edu.ar/catalogo.cgi?wAccion=oferta_view&oferta_id=751");
});

test("CeNET mantiene una instancia por cohorte del mismo curso", async () => {
  const html = await readFile(new URL("./fixtures/cenet-cohort-sample.html", import.meta.url), "utf8");
  const first = parseCenetTrainings(html.replace("6ta cohorte", "5ta cohorte"), new Date("2026-08-30T12:00:00-03:00"))[0];
  const second = parseCenetTrainings(html, new Date("2026-10-11T12:00:00-03:00"))[0];
  assert.notEqual(first.id, second.id);
  assert.equal(second.status, "inscripción abierta");
  assert.equal(second.metadata.dateStatus, "tentative");
  assert.equal(parseCenetTrainings(html.replace("6ta cohorte <span>ABIERTA</span>", "6ta cohorte"), new Date("2026-10-11T12:00:00-03:00"))[0].status, "consultar", "el calendario tentativo solo no demuestra inscripción abierta");
  assert.equal(isHistoricalCenetOffer(first.id, second.id), true);
  assert.equal(isHistoricalCenetOffer(second.id, second.id), false);
  assert.equal(isHistoricalCenetOffer("cenet:2026:6:curso", "cenet:2027:1:curso"), true);
});
