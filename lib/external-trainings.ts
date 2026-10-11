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
  // The course cards describe the cohort named above them; the calendar alone cannot identify that association.
  const advertised = plainText(html).match(/(\d+)(?:ta|a|°)?\s+cohorte\s+ABIERTA/i);
  const cohort = (advertised && cohorts.find((item) => item.number === Number(advertised[1])))
    || cohorts.find((item) => item.closes && Date.parse(item.closes) >= now.getTime()) || cohorts.at(-1);
  if (!cohort) return [];
  const tentative = /fechas\s+tentativas/i.test(plainText(html));
  const categories = [...html.matchAll(/<div[^>]*>([^<>]{4,100})<span[^>]*>\s*\d+\s+cursos<\/span><\/div>/gi)];
  return [...html.matchAll(/<button\b[^>]*\bonclick="cnetPop\(this\)"[^>]*>/gi)].map((match) => {
    const tag = match[0], title = attr(tag, "data-t"), id = attr(tag, "data-slug") || slug(title), registrationUrl = attr(tag, "data-i");
    const summary = attr(tag, "data-s"), recipients = attr(tag, "data-d"), level = attr(tag, "data-n"), area = attr(tag, "data-f"), hours = attr(tag, "data-ch");
    const category = plainText(categories.filter((entry) => (entry.index || 0) < (match.index || 0)).at(-1)?.[1] || "Cursos virtuales");
    const sourceUrl = "https://cenet.inet.edu.ar/mod/page/view.php?id=30493";
    const metadata: TrainingMetadata = { entity: "course", trainingId: `cenet:${year}:${cohort.number}:${id}`, cohort: cohort.number, category, registrationOpensAt: cohort.opens, registrationHasTime: false, registrationClosesAt: cohort.closes, courseStartsAt: cohort.starts, courseEndsAt: cohort.ends, source: "CeNET / INET", sourceUrl, registrationUrl: /^https:\/\//i.test(registrationUrl) ? registrationUrl : undefined, dateStatus: tentative ? "tentative" : "confirmed", certifiedHours: hours, recipients, content: summary, organization: "Centro Nacional de Educación Tecnológica (INET)" };
    const calculatedStatus = statusFor(cohort.opens, cohort.closes, cohort.starts, cohort.ends, now);
    const status = tentative && calculatedStatus === "inscripción abierta" && !advertised ? "consultar" : calculatedStatus;
    return { id: `cenet:${year}:${cohort.number}:${id}`, externalId: `${year}:${cohort.number}:${id}`, title, summary: [summary, recipients, hours].filter(Boolean).join(" · "), level, area, modality: "Virtual", startsAt: cohort.starts || null, endsAt: cohort.closes || null, status, officialUrl: sourceUrl, metadata, raw: tag };
  }).filter((item) => Boolean(item.title));
}

export function isCenetMarkupRecognized(html: string) {
  const text = plainText(html).toLocaleLowerCase("es");
  return ["inicio preinscripción", "fin preinscripción", "inicio de cohorte", "fin de cohorte"].every((label) => text.includes(label))
    && /cnetPop\(this\)/i.test(html);
}

export function isHistoricalCenetOffer(oldId: string, advertisedId: string) {
  const key = (id: string) => {
    const match = id.match(/^cenet:(\d{4}):(\d+):/);
    return match ? Number(match[1]) * 100 + Number(match[2]) : null;
  };
  const oldKey = key(oldId), advertisedKey = key(advertisedId);
  return oldKey !== null && advertisedKey !== null && oldKey < advertisedKey;
}

export function parseInfdCatalog(html: string, now = new Date()) {
  const text = plainText(html), year = Number(text.match(/(?:Propuestas nacionales|Cursos nacionales)\s*(20\d{2})/i)?.[1] || html.match(/href="[^"]+-(20\d{2})\/"/i)?.[1] || text.match(/©\s*(20\d{2})/)?.[1] || now.getFullYear());
  const dates = text.match(/Fecha de inscripción:\s*(\d{1,2}) de ([a-záéíóú]+) al (\d{1,2}) de ([a-záéíóú]+)/i);
  const starts = text.match(/Inicio de cursado:\s*semana del (\d{1,2}) de ([a-záéíóú]+)/i);
  const monthValue = (name: string) => ({ enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 }[name.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "")] || 0);
  const date = (day: string, month: string, end = false) => `${year}-${String(monthValue(month)).padStart(2, "0")}-${day.padStart(2, "0")}T${end ? "23:59:59" : "00:00:00"}-03:00`;
  const registrationOpensAt = dates ? date(dates[1], dates[2]) : undefined, registrationClosesAt = dates ? date(dates[3], dates[4], true) : undefined, courseStartsAt = starts ? date(starts[1], starts[2]) : undefined;
  // The official CURSOS submenu is the catalogue; page slugs are not a stable taxonomy.
  const menu = html.match(/>CURSOS(?:<[^>]+>)*<\/a>\s*<ul class="sub-menu">([\s\S]*?)<\/ul>/i)?.[1] || html;
  const pages = [...menu.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>/gi)].map((match) => {
    try { return new URL(decode(match[1]), "https://red.infd.edu.ar/").href; } catch { return ""; }
  }).filter((url) => url.startsWith("https://red.infd.edu.ar/") && !url.endsWith("/cursos-nacionales-2/"));
  return { registrationOpensAt, registrationClosesAt, courseStartsAt, pages: [...new Set(pages)] };
}

export function parseInfdTrainings(html: string, pageUrl: string, dates: ReturnType<typeof parseInfdCatalog>, now = new Date()): PublicTraining[] {
  const heading = plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "");
  const year = Number(heading.match(/\b(20\d{2})\b/)?.[1] || dates.registrationOpensAt?.slice(0, 4) || now.getFullYear());
  const category = heading.replace(/\s+20\d{2}\b/, "").trim() || "Cursos nacionales";
  const listing = html.search(/(?:Listado de cursos|Por favor, lea con atención los contenidos antes de inscribirse)/i);
  const body = listing < 0 ? html : html.slice(listing);
  const blocks = [...body.matchAll(/<p\b[^>]*(?:font-size:\s*(?:26|28|30)px|has-large-font-size)[^>]*>\s*<strong>([\s\S]*?)<\/strong>\s*<\/p>/gi)];
  const pageText = plainText(html);
  const pageIntroduction = listing < 0 ? "" : plainText(html.slice(0, listing));
  const pageWindow = pageText.match(/Fecha de inscripción:\s*(\d{1,2}) de ([a-záéíóú]+) al (\d{1,2}) de ([a-záéíóú]+)/i);
  const sharedWindowApplies = Boolean(pageWindow || /[úu]nico formulario de inscripci[oó]n|mismo formulario/i.test(pageText));
  const inPageYear = (value: string | undefined) => value?.replace(/^20\d{2}/, String(year));
  const pageDates = pageWindow ? parseInfdCatalog(`<p>Fecha de inscripción: ${pageWindow[0].split(":")[1]}</p>`, new Date(`${year}-01-01T12:00:00-03:00`)) : sharedWindowApplies ? { ...dates, registrationOpensAt: inPageYear(dates.registrationOpensAt), registrationClosesAt: inPageYear(dates.registrationClosesAt) } : { registrationOpensAt: undefined, registrationClosesAt: undefined, courseStartsAt: undefined };
  const sharedForm = [...html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
    .find((link) => /ACCESO AL FORMULARIO DE INSCRIPCIÓN/i.test(plainText(link[2])));
  const sharedRegistrationUrl = sharedForm ? decode(sharedForm[1]) : undefined;
  return blocks.map((match, index) => {
    const title = plainText(match[1]);
    if (!title || /listado de cursos|información importante|^ciclo:|^educación financiera para docentes|^educación tributaria$/i.test(title)) return null;
    const section = body.slice((match.index || 0) + match[0].length, blocks[index + 1]?.index ?? body.length).split(/<footer\b|ACCESO AL FORMULARIO DE INSCRIPCIÓN/i)[0];
    const following = plainText(section);
    const individualLink = [...section.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi)]
      .find((link) => /^INSCRIPCI[OÓ]N$/i.test(plainText(link[2])));
    const registrationUrl = individualLink ? decode(individualLink[1]) : sharedRegistrationUrl;
    const recipients = following.match(/(?:Destinatarios|Destinado a):\s*([^.<]+)/i)?.[1]?.split(/Cupo:|Modalidad:|Duraci[oó]n:|Se certifican|INICIO:/i)[0].trim() || pageIntroduction.match(/Destinatarios:\s*([^.<]+)/i)?.[1]?.trim() || "Docentes";
    const specificRange = following.match(/(?:fecha de inscripci[oó]n|inscripci[oó]n del curso)\s*:?\s*(\d{1,2}\/\d{1,2}\/\d{4})\s*(?:al|hasta)\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const specificStart = following.match(/(?:INICIO|inicio de cursado|comienza el curso)\s*:?\s*-?\s*(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i);
    const parseSpecificDate = (raw: string | undefined, end = false) => {
      const parts = raw?.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
      return parts ? `${parts[3] || year}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}T${end ? "23:59:59" : "00:00:00"}-03:00` : undefined;
    };
    const specificClose = following.match(/inscripci[oó]n\s+abierta\s+hasta\s+el\s+(\d{1,2}\/\d{1,2}(?:\/\d{4})?)/i);
    const registrationOpensAt = specificRange ? parseSpecificDate(specificRange[1]) : pageDates.registrationOpensAt;
    const registrationClosesAt = specificRange ? parseSpecificDate(specificRange[2], true) : specificClose ? parseSpecificDate(specificClose[1], true) : pageDates.registrationClosesAt;
    const courseStartsAt = specificStart ? parseSpecificDate(specificStart[1]) : undefined;
    const duration = following.match(/Duraci[oó]n:\s*([^.<]+)/i)?.[1]?.split(/Se certifican|Destinatarios|Modalidad|INICIO:/i)[0].trim();
    const certifiedHours = following.match(/Se certifican:?\s*(\d+\s*(?:horas|h\b)[^.<]*)/i)?.[1]?.split(/Duraci[oó]n:|Destinatarios:|Modalidad:|INICIO:/i)[0].trim();
    const weeks = Number(duration?.match(/(\d+)\s*semanas?/i)?.[1] || 0);
    // A duration can classify the current phase, but it is not an official exact end date.
    const estimatedEnd = courseStartsAt && weeks ? Date.parse(courseStartsAt) + weeks * 7 * 864e5 : 0;
    const explicitClosed = /^inscripci[oó]n cerrada\b/i.test(following);
    const status = explicitClosed || (registrationClosesAt && now.getTime() > Date.parse(registrationClosesAt))
      ? courseStartsAt && estimatedEnd > now.getTime() && now.getTime() >= Date.parse(courseStartsAt) ? "en curso" : estimatedEnd && now.getTime() >= estimatedEnd ? "finalizada" : "inscripción cerrada"
      : registrationOpensAt || registrationClosesAt ? statusFor(registrationOpensAt, registrationClosesAt, courseStartsAt, undefined, now) : "consultar";
    const modality = following.match(/Modalidad:\s*([^.<]+)/i)?.[1]?.split(/Duraci[oó]n:|Destinatarios:|Se certifican|INICIO:/i)[0].trim() || (/autoasistid/i.test(pageText) ? "Virtual autoasistida" : "Virtual");
    const id = slug(`${new URL(pageUrl).pathname}-${title}`), metadata: TrainingMetadata = {
      entity: "course", trainingId: `infd:${id}`, category, registrationOpensAt, registrationHasTime: false, registrationClosesAt, courseStartsAt,
      ...(dates.registrationOpensAt ? { generalWindowOpensAt: inPageYear(dates.registrationOpensAt) } : {}), ...(dates.registrationClosesAt ? { generalWindowClosesAt: inPageYear(dates.registrationClosesAt) } : {}),
      source: "INFoD / AulaS-TIC", sourceUrl: pageUrl, registrationUrl: registrationUrl?.startsWith("https://") ? registrationUrl : undefined, dateStatus: registrationOpensAt || registrationClosesAt ? "confirmed" : courseStartsAt ? "course_confirmed" : "unknown", recipients, duration, certifiedHours, content: following.slice(0, 1000), organization: "Instituto Nacional de Formación Docente",
    };
    return { id: `infd:${id}`, externalId: id, title, summary: following.slice(0, 1800), level: recipients, area: title, modality, startsAt: courseStartsAt || null, endsAt: registrationClosesAt || null, status, officialUrl: pageUrl, metadata, raw: match[0] + following };
  }).filter((item): item is PublicTraining => Boolean(item));
}

export function parseInfdWebinars(html: string, pageUrl: string, now = new Date()): PublicTraining[] {
  const year = Number(plainText(html.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || "").match(/20\d{2}/)?.[0] || now.getFullYear());
  const blocks = [...html.matchAll(/<div class="wp-block-columns\b[^>]*>/gi)];
  return blocks.flatMap((block, index) => {
    const section = html.slice(block.index, blocks[index + 1]?.index ?? html.length);
    const event = section.match(/<p[^>]*>\s*<strong>([\s\S]*?)<\/strong>(?:\s*<\/strong>)*\s*:\s*([\s\S]*?)<\/p>/i);
    if (!event) return [];
    const dateText = plainText(event[1]), title = plainText(event[2]);
    const date = dateText.match(/(\d{1,2})(?:\s+y\s+(\d{1,2}))?\s+de\s+([a-záéíóú]+)/i);
    if (!date || !title || /primer encuentro|segundo encuentro|tercer encuentro|cuarto encuentro/i.test(title)) return [];
    const eventDay = atTucuman(year, `${date[1]}-${date[3].slice(0, 3)}`);
    const hour = dateText.match(/,\s*(\d{1,2})(?::(\d{2}))?\s*h\b/i);
    const starts = eventDay && hour ? eventDay.replace("T00:00:00", `T${hour[1].padStart(2, "0")}:${hour[2] || "00"}:00`) : eventDay;
    const lastMeeting = atTucuman(year, `${date[2] || date[1]}-${date[3].slice(0, 3)}`, true);
    const registration = section.match(/<a\b[^>]*href="([^"]+)"[^>]*>\s*Inscripci[oó]n\s*<\/a>/i);
    const registrationUrl = registration ? decode(registration[1]) : undefined;
    const category = "Webinarios INFoD";
    const id = `infd:webinar:${year}:${starts?.slice(0, 10) || "sin-fecha"}:${slug(title)}`;
    const status: TrainingStatus = lastMeeting && now.getTime() > Date.parse(lastMeeting) ? "finalizada" : registrationUrl ? "consultar" : "próximamente";
    const metadata: TrainingMetadata = { entity: "course", trainingId: id, category, source: "INFoD / AulaS-TIC", sourceUrl: pageUrl, registrationUrl: registrationUrl?.startsWith("https://") ? registrationUrl : undefined, courseStartsAt: starts, courseEndsAt: lastMeeting, dateStatus: starts ? "course_confirmed" : "unknown", duration: "Encuentro sincrónico de 1,5 horas", organization: "Instituto Nacional de Formación Docente" };
    return [{ id, externalId: id, title, summary: `${category} · ${dateText}`, level: "Docentes", area: category, modality: "Virtual sincrónica", startsAt: starts || null, endsAt: null, status, officialUrl: pageUrl, metadata, raw: section.slice(0, 1200) }];
  });
}
