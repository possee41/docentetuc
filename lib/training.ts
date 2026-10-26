import { calendarDayDistance } from "./home-dashboard.ts";

export type TrainingStatus = "inscripción abierta" | "próximamente" | "inscripción cerrada" | "en curso" | "finalizada" | "consultar";
export type EnrollmentState = "PROXIMAMENTE" | "ABRE_HOY" | "ABIERTA" | "SIN_CUPO" | "CERRADA" | "SIN_FECHA_CONFIRMADA";

export type TrainingMetadata = {
  entity: "course" | "commission";
  trainingId: string;
  commissionId?: string;
  registrationOpensAt?: string;
  registrationHasTime?: boolean;
  registrationClosesAt?: string;
  preinscripcionFechaConfirmada?: boolean;
  courseStartsAt?: string;
  courseEndsAt?: string;
  source?: string;
  sourceUrl?: string;
  category?: string;
  cohort?: number;
  duration?: string;
  certifiedHours?: string;
  registrationUrl?: string;
  dateStatus?: "confirmed" | "tentative" | "course_confirmed" | "general_window" | "unknown";
  generalWindowOpensAt?: string;
  generalWindowClosesAt?: string;
  generalWindowCourseStartsAt?: string;
  address?: string;
  capacity?: number;
  preCapacity?: number;
  availablePreCapacity?: number;
  hours?: number;
  meetings?: number;
  recipients?: string;
  schedule?: string;
  content?: string;
  organization?: string;
};

export type OfficialCourse = Record<string, unknown> & { capacitacion_id?: number | string };
export type OfficialCommission = Record<string, unknown> & { id?: number | string; capacitacion_id?: number | string };

export type TrainingOpportunity = {
  id: string; externalId: string; title: string; summary: string; level: string; area: string; location: string;
  modality: string; startsAt: string | null; endsAt: string | null; status: TrainingStatus; officialUrl: string;
  sourceUpdatedAt: string | null; metadata: TrainingMetadata; raw: { course: OfficialCourse; commission?: OfficialCommission };
};

const text = (value: unknown) => value == null ? "" : String(value);
const number = (value: unknown) => value == null || value === "" || Number.isNaN(Number(value)) ? undefined : Number(value);
const localDateTime = (value: unknown, endOfDay = false) => {
  const raw = text(value).trim();
  if (!raw) return undefined;
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00`
    : `${raw.replace(" ", "T")}${/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? "" : "-03:00"}`;
  return Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
};
export const plainText = (value: unknown) => text(value).replace(/<[^>]*>/g, " ")
  .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, digits: string) => {
    const point = Number.parseInt(digits[0].toLowerCase() === "x" ? digits.slice(1) : digits, digits[0].toLowerCase() === "x" ? 16 : 10);
    return point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  }).replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();

export function enrollmentState(metadata: TrainingMetadata | null, sourceStatus = "", normalizedStatus = "", now = new Date()): EnrollmentState {
  if (["CLOSED", "EXPIRED", "REMOVED_FROM_SOURCE"].includes(normalizedStatus)) return "CERRADA";
  if (/cerrad|finaliz|vencid|desaparecid/i.test(sourceStatus)) return "CERRADA";
  if (!metadata || ["general_window", "unknown"].includes(metadata.dateStatus || "unknown")) return "SIN_FECHA_CONFIRMADA";
  const opens = metadata.registrationOpensAt ? Date.parse(metadata.registrationOpensAt) : Number.NaN;
  const closes = metadata.registrationClosesAt ? Date.parse(metadata.registrationClosesAt) : Number.NaN;
  const time = now.getTime();
  if (Number.isFinite(closes) && time > closes) return "CERRADA";
  if (metadata.availablePreCapacity != null && metadata.availablePreCapacity <= 0) return "SIN_CUPO";
  if (Number.isFinite(opens) && time < opens) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    return day.format(now) === day.format(new Date(opens)) ? "ABRE_HOY" : "PROXIMAMENTE";
  }
  if (Number.isFinite(opens) && metadata.registrationHasTime === false && !/abiert/i.test(sourceStatus)) {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
    if (day.format(now) === day.format(new Date(opens))) return "ABRE_HOY";
  }
  // A tentative calendar is a forecast, not proof that registration actually opened.
  if (metadata.dateStatus === "tentative") return /abiert/i.test(sourceStatus) && Number.isFinite(opens) && opens <= time &&
    Number.isFinite(closes) && time <= closes ? "ABIERTA" : "SIN_FECHA_CONFIRMADA";
  if (Number.isFinite(opens) && Number.isFinite(closes) && time <= closes) return "ABIERTA";
  if (Number.isFinite(opens) && /abiert/i.test(sourceStatus)) return "ABIERTA";
  return "SIN_FECHA_CONFIRMADA";
}

export function canScheduleTrainingReminder(metadata: TrainingMetadata | null, sourceStatus = "", normalizedStatus = "", now = new Date()) {
  if (metadata?.dateStatus !== "confirmed" || metadata.registrationHasTime !== true || !metadata.registrationOpensAt) return false;
  const opens = Date.parse(metadata.registrationOpensAt);
  return Number.isFinite(opens) && opens > now.getTime() &&
    ["PROXIMAMENTE", "ABRE_HOY"].includes(enrollmentState(metadata, sourceStatus, normalizedStatus, now));
}

export function trainingStatus(commission: OfficialCommission | undefined, now = new Date()): TrainingStatus {
  if (!commission) return "consultar";
  const time = now.getTime();
  const opens = localDateTime(commission.fecha_apertura_preinscripcion);
  const closes = localDateTime(commission.fecha_cierre_preinscripcion, true);
  const starts = localDateTime(commission.fecha_inicio);
  const finishes = localDateTime(commission.fecha_fin, true);
  const closed = Boolean(Number(commission.comision_cerrada));
  if (closed) return "inscripción cerrada";
  if (opens && commission.isActivePre != null && !Boolean(Number(commission.isActivePre))) return "inscripción cerrada";
  if (opens && time < new Date(opens).getTime()) return "próximamente";
  if (closes && time > new Date(closes).getTime()) return "inscripción cerrada";
  if (opens && (closes || Boolean(Number(commission.isActivePre)))) return "inscripción abierta";
  if (starts && time < new Date(starts).getTime()) return "consultar";
  if (starts && finishes && time <= new Date(finishes).getTime()) return "en curso";
  if (finishes && time > new Date(finishes).getTime()) return "finalizada";
  return "consultar";
}

export function openingCountdown(opensAt: string, now = new Date(), hasTime = true) {
  const difference = new Date(opensAt).getTime() - now.getTime();
  if (difference <= 0) return "Abre hoy";
  const sameDay = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" });
  const today = sameDay.format(now), openingDay = sameDay.format(new Date(opensAt));
  if (today === openingDay) {
    if (!hasTime) return "Abre hoy";
    const minutes = Math.ceil(difference / 60000), hours = Math.floor(minutes / 60);
    return hours ? `Abre en ${hours} h ${minutes % 60} min` : `Abre en ${minutes} min`;
  }
  const days = calendarDayDistance(opensAt, now) || 1;
  return days === 1 ? "Abre mañana" : `Abre en ${days} días`;
}

function opportunity(course: OfficialCourse, commission?: OfficialCommission, now = new Date()): TrainingOpportunity {
  const trainingId = text(commission?.capacitacion_id || course.capacitacion_id);
  const commissionId = commission?.id == null ? "" : text(commission.id);
  const token = text(course.token || commission?.token), slug = text(course.slug || commission?.slug);
  // The catalogue's "next" date can disagree with the actual commission.
  const rawOpening = commission?.fecha_apertura_preinscripcion;
  const registrationOpensAt = localDateTime(rawOpening);
  const registrationHasTime = /\d{1,2}:\d{2}/.test(text(rawOpening));
  const registrationClosesAt = localDateTime(commission?.fecha_cierre_preinscripcion, true);
  const courseStartsAt = localDateTime(commission?.fecha_inicio);
  const courseEndsAt = localDateTime(commission?.fecha_fin, true);
  const dateStatus = registrationOpensAt || registrationClosesAt ? "confirmed" : courseStartsAt || courseEndsAt ? "course_confirmed" : "unknown";
  const description = plainText(course.descripcion || commission?.descripcion);
  const content = plainText(course.contenido || commission?.contenido);
  const statedRecipients = description.match(/destinatarios\s*:\s*([^.]*)/i)?.[1]?.trim();
  const officialUrl = token && slug ? `https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones/${token}/${slug}${commissionId ? `/${commissionId}` : ""}` : "https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones";
  return {
    id: commissionId ? `fdci:commission:${commissionId}` : `fdci:course:${trainingId}`,
    externalId: commissionId || trainingId,
    title: text(course.nombre || commission?.nombre || "Capacitación docente"),
    summary: (description || content).slice(0, 2000),
    level: text(course.niveles), area: text(course.areas || course.eje_prioritario),
    location: text(commission?.lugar), modality: text(course.modalidad || commission?.modalidad),
    startsAt: courseStartsAt || null, endsAt: registrationClosesAt || null,
    status: trainingStatus(commission, now), officialUrl,
    sourceUpdatedAt: text(commission?.updated_at) || null,
    metadata: {
      entity: commissionId ? "commission" : "course", trainingId, ...(commissionId ? { commissionId } : {}),
      ...(registrationOpensAt ? { registrationOpensAt, registrationHasTime } : {}), ...(registrationClosesAt ? { registrationClosesAt } : {}), preinscripcionFechaConfirmada: Boolean(registrationOpensAt),
      ...(courseStartsAt ? { courseStartsAt } : {}), ...(courseEndsAt ? { courseEndsAt } : {}), source: "FDCI Tucumán", sourceUrl: officialUrl, dateStatus,
      ...(commission?.direccion ? { address: text(commission.direccion) } : {}),
      ...(number(commission?.cupo) != null ? { capacity: number(commission?.cupo) } : {}),
      ...(number(commission?.cupo_preinscripcion) != null ? { preCapacity: number(commission?.cupo_preinscripcion) } : {}),
      ...(number(commission?.cupo_disponible_pre) != null ? { availablePreCapacity: number(commission?.cupo_disponible_pre) } : {}),
      ...(number(course.horas_catedra) != null ? { hours: number(course.horas_catedra) } : {}),
      ...(number(commission?.cantidad_encuentros) != null ? { meetings: number(commission?.cantidad_encuentros) } : {}),
      ...(statedRecipients || [course.cargos, course.niveles, course.areas].filter(Boolean).length ? { recipients: statedRecipients || [course.cargos, course.niveles, course.areas].filter(Boolean).map(text).join(" · ") } : {}),
      ...(commission?.cronograma ? { schedule: plainText(commission.cronograma) } : {}), ...(content ? { content } : {}),
      ...(course.nombre_direccion || commission?.nombre_direccion ? { organization: text(course.nombre_direccion || commission?.nombre_direccion) } : {}),
    },
    raw: { course, ...(commission ? { commission } : {}) },
  };
}

export function mergeTrainingData(courses: OfficialCourse[], commissions: OfficialCommission[], now = new Date()) {
  const byTraining = new Map<string, OfficialCommission[]>();
  for (const commission of commissions) {
    const id = text(commission.capacitacion_id);
    if (!id) continue;
    byTraining.set(id, [...(byTraining.get(id) || []), commission]);
  }
  const courseIds = new Set(courses.map((course) => text(course.capacitacion_id)));
  const result = courses.flatMap((course) => {
    const linked = byTraining.get(text(course.capacitacion_id)) || [];
    return linked.length ? linked.map((commission) => opportunity(course, commission, now)) : [opportunity(course, undefined, now)];
  });
  for (const commission of commissions) if (!courseIds.has(text(commission.capacitacion_id))) result.push(opportunity(commission, commission, now));
  return [...new Map(result.map((item) => [item.id, item])).values()];
}

export const parseTrainingMetadata = (value: string | null | undefined): TrainingMetadata | null => {
  try { return value ? JSON.parse(value) as TrainingMetadata : null; } catch { return null; }
};

export const trainingReminderKey = (metadata: TrainingMetadata) => metadata.commissionId ? `fdci:commission:${metadata.commissionId}` : metadata.trainingId;

// Recheck a stored reminder against the current publication before queuing it.
// The single placeholder is the current instant, supplied by the caller.
export const CONFIRMED_TRAINING_REMINDER_SQL = `EXISTS (SELECT 1 FROM publications p
  WHERE p.id=training_reminders.publication_id AND p.kind='capacitacion'
  AND p.normalized_status NOT IN ('CLOSED','EXPIRED','REMOVED_FROM_SOURCE')
  AND CASE WHEN json_valid(p.metadata) THEN
    json_extract(p.metadata,'$.dateStatus')='confirmed'
    AND json_extract(p.metadata,'$.registrationHasTime')=1
    AND json_extract(p.metadata,'$.registrationOpensAt')=training_reminders.opens_at
    AND COALESCE(json_extract(p.metadata,'$.availablePreCapacity'),1)>0
    AND (json_extract(p.metadata,'$.registrationClosesAt') IS NULL OR
      datetime(json_extract(p.metadata,'$.registrationClosesAt'))>=datetime(?))
  ELSE 0 END)`;
