import { plainText, type TrainingMetadata, type TrainingStatus } from "./training.ts";

export type PublicTraining = {
  id: string; externalId: string; title: string; summary: string; level: string; area: string; modality: string;
  startsAt: string | null; endsAt: string | null; status: TrainingStatus; officialUrl: string; metadata: TrainingMetadata; raw: string;
};

const decode = (value = "") => value.replace(/&quot;/g, '"').replace(/&#039;|&#39;/g, "'").replace(/&amp;/g, "&").replace(/&nbsp;|&#160;/g, " ").replace(/&aacute;/g, "á").replace(/&eacute;/g, "é").replace(/&iacute;/g, "í").replace(/&oacute;/g, "ó").replace(/&uacute;/g, "ú").replace(/&ntilde;/g, "ñ");
const attr = (tag: string, name: string) => decode(tag.match(new RegExp(`\\s${name}="([^"]*)"`, "i"))?.[1] || "");
const slug = (value: string) => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
const atTucuman = (year: number, value: string, end = false) => {
  const months: Record<string, string> = { ene: "01", feb: "02", mar: "03", abr: "04", may: "05", jun: "06", jul: "07", ago: "08", sep: "09", oct: "10", nov: "11", dic: "12" };
  const match = value.toLocaleLowerCase("es").match(/(\d{1,2})[-/]([a-záéíóú]{3}|\d{1,2})(?:[-/](\d{2,4}))?/);
  if (!match) return undefined;
  const resolvedYear = match[3] ? Number(match[3].length === 2 ? `20${match[3]}` : match[3]) : year;
  const month = /^\d+$/.test(match[2]) ? match[2].padStart(2, "0") : months[match[2].normalize("NFD").replace(/[\u0300-\u036f]/g, "")];
  return month ? `${resolvedYear}-${month}-${match[1].padStart(2, "0")}T${end ? "23:59:59" : "00:00:00"}-03:00` : undefined;
};
const statusFor = (opens: string | undefined, closes: string | undefined, starts: string | undefined, ends: string | undefined, now: Date): TrainingStatus => {
  const time = now.getTime();
  if (opens && time < Date.parse(opens)) return "próximamente";
  if (closes && time <= Date.parse(closes)) return "inscripción abierta";
  if (starts && time < Date.parse(starts)) return "inscripción cerrada";
  if (ends && time <= Date.parse(ends)) return "en curso";
  return ends && time > Date.parse(ends) ? "finalizada" : "consultar";
};

const calendarRow = (html: string, label: string) => {
  const start = html.toLocaleLowerCase("es").indexOf(label.toLocaleLowerCase("es"));
  if (start < 0) return [];
  return [...html.slice(start, start + 2800).matchAll(/>(\d{1,2}-(?:ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic)(?:-\d{2,4})?)</gi)].slice(0, 6).map((match) => match[1]);
};

export function parseCenetTrainings(html: string, now = new Date()): PublicTraining[] {
  const year = Number(html.match(/Calendario de cohortes\s+(20\d{2})/i)?.[1] || now.getFullYear());
  const rows = [calendarRow(html, "Inicio preinscripción"), calendarRow(html, "Fin preinscripción"), calendarRow(html, "Inicio de cohorte"), calendarRow(html, "Fin de cohorte")];
  const cohorts = Array.from({ length: Math.min(...rows.map((row) => row.length)) }, (_, index) => ({
    number: index + 1, opens: atTucuman(year, rows[0][index]), closes: atTucuman(year, rows[1][index], true), starts: atTucuman(year, rows[2][index]), ends: atTucuman(year, rows[3][index], true),
  }));
  const cohort = cohorts.find((item) => item.closes && Date.parse(item.closes) >= now.getTime()) || cohorts.at(-1);
  if (!cohort) return [];
  const tentative = /fechas\s+tentativas/i.test(plainText(html));
  return [...html.matchAll(/<button\b[^>]*\bonclick="cnetPop\(this\)"[^>]*>/gi)].map((match) => {
    const tag = match[0], title = attr(tag, "data-t"), id = attr(tag, "data-slug") || slug(title), registrationUrl = attr(tag, "data-i");
    const summary = attr(tag, "data-s"), recipients = attr(tag, "data-d"), level = attr(tag, "data-n"), area = attr(tag, "data-f"), hours = attr(tag, "data-ch");
    const metadata: TrainingMetadata = { entity: "course", trainingId: `cenet:${year}:${cohort.number}:${id}`, registrationOpensAt: cohort.opens, registrationHasTime: false, registrationClosesAt: cohort.closes, courseStartsAt: cohort.starts, courseEndsAt: cohort.ends, source: "CeNET / INET", sourceUrl: "https://cenet.inet.edu.ar/mod/page/view.php?id=30493", dateStatus: tentative ? "tentative" : "confirmed", recipients, content: summary, organization: "Centro Nacional de Educación Tecnológica (INET)" };
    return { id: `cenet:${year}:${cohort.number}:${id}`, externalId: `${year}:${cohort.number}:${id}`, title, summary: [summary, recipients, hours].filter(Boolean).join(" · "), level, area, modality: "Virtual", startsAt: cohort.starts || null, endsAt: cohort.closes || null, status: statusFor(cohort.opens, cohort.closes, cohort.starts, cohort.ends, now), officialUrl: registrationUrl || metadata.sourceUrl!, metadata, raw: tag };
  }).filter((item) => Boolean(item.title));
}

export function isCenetMarkupRecognized(html: string) {
  const text = plainText(html).toLocaleLowerCase("es");
  return ["inicio preinscripción", "fin preinscripción", "inicio de cohorte", "fin de cohorte"].every((label) => text.includes(label))
    && /cnetPop\(this\)/i.test(html);
}

export function parseInfdCatalog(html: string, now = new Date()) {
  const text = plainText(html), year = now.getFullYear();
  const dates = text.match(/Fecha de inscripción:\s*(\d{1,2}) de ([a-záéíóú]+) al (\d{1,2}) de ([a-záéíóú]+)/i);
  const starts = text.match(/Inicio de cursado:\s*semana del (\d{1,2}) de ([a-záéíóú]+)/i);
  const monthValue = (name: string) => ({ enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 }[name.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")] || 0);
  const date = (day: string, month: string, end = false) => `${year}-${String(monthValue(month)).padStart(2, "0")}-${day.padStart(2, "0")}T${end ? "23:59:59" : "00:00:00"}-03:00`;
  const registrationOpensAt = dates ? date(dates[1], dates[2]) : undefined, registrationClosesAt = dates ? date(dates[3], dates[4], true) : undefined, courseStartsAt = starts ? date(starts[1], starts[2]) : undefined;
  const pages = [...html.matchAll(/href="(https:\/\/red\.infd\.edu\.ar\/[^"#?]+\/)"/gi)].map((match) => match[1]).filter((url) => /curso|convivencia|educacion-financiera|idiomas|socioemocionales|ia-y-educacion|matematica|mineria/.test(url) && !url.endsWith("cursos-nacionales-2/"));
  return { registrationOpensAt, registrationClosesAt, courseStartsAt, pages: [...new Set(pages)] };
}

export function parseInfdTrainings(html: string, pageUrl: string, dates: ReturnType<typeof parseInfdCatalog>, now = new Date()): PublicTraining[] {
  const blocks = [...html.matchAll(/<p\b[^>]*(?:font-size:\s*30px|has-large-font-size)[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/gi)];
  return blocks.map((match) => {
    const title = plainText(match[1]);
    if (!title || /listado de cursos|información importante/i.test(title)) return null;
    const following = plainText(html.slice((match.index || 0) + match[0].length, (match.index || 0) + match[0].length + 1800));
    const recipients = plainText(html).match(/Destinatarios:\s*([^.<]+)/i)?.[1]?.trim() || "Docentes";
    const specificRange = following.match(/(?:fecha de inscripci[oó]n|inscripci[oó]n del curso)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:al|hasta)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const specificStart = following.match(/(?:inicio de cursado|comienza el curso)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const parseSpecificDate = (raw: string | undefined, end = false) => {
      const parts = raw?.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      return parts ? `${parts[3]}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}T${end ? "23:59:59" : "00:00:00"}-03:00` : undefined;
    };
    const registrationOpensAt = specificRange ? parseSpecificDate(specificRange[1]) : undefined;
    const registrationClosesAt = specificRange ? parseSpecificDate(specificRange[2], true) : undefined;
    const courseStartsAt = specificStart ? parseSpecificDate(specificStart[1]) : undefined;
    const id = slug(`${new URL(pageUrl).pathname}-${title}`), metadata: TrainingMetadata = {
      entity: "course", trainingId: `infd:${id}`, ...(registrationOpensAt ? { registrationOpensAt, registrationHasTime: false } : {}), ...(registrationClosesAt ? { registrationClosesAt } : {}), ...(courseStartsAt ? { courseStartsAt } : {}),
      ...(dates.registrationOpensAt ? { generalWindowOpensAt: dates.registrationOpensAt } : {}), ...(dates.registrationClosesAt ? { generalWindowClosesAt: dates.registrationClosesAt } : {}), ...(dates.courseStartsAt ? { generalWindowCourseStartsAt: dates.courseStartsAt } : {}),
      source: "INFoD / AulaS-TIC", sourceUrl: pageUrl, dateStatus: specificRange || specificStart ? "course_confirmed" : dates.registrationOpensAt || dates.registrationClosesAt || dates.courseStartsAt ? "general_window" : "unknown", recipients, content: following.slice(0, 1000), organization: "Instituto Nacional de Formación Docente",
    };
    return { id: `infd:${id}`, externalId: id, title, summary: following.slice(0, 1800), level: recipients, area: title, modality: "Virtual autoasistida", startsAt: courseStartsAt || null, endsAt: registrationClosesAt || null, status: statusFor(registrationOpensAt, registrationClosesAt, undefined, undefined, now), officialUrl: pageUrl, metadata, raw: match[0] + following };
  }).filter((item): item is PublicTraining => Boolean(item));
}
