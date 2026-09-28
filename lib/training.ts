export type TrainingStatus = "inscripción abierta" | "próximamente" | "inscripción cerrada" | "en curso" | "finalizada" | "consultar";

export type TrainingMetadata = {
  entity: "course" | "commission";
  trainingId: string;
  commissionId?: string;
  registrationOpensAt?: string;
  registrationHasTime?: boolean;
  registrationClosesAt?: string;
  courseStartsAt?: string;
  courseEndsAt?: string;
  source?: string;
  sourceUrl?: string;
  dateStatus?: "confirmed" | "tentative";
  address?: string;
  capacity?: number;
  preCapacity?: number;
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
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T${endOfDay ? "23:59:59" : "00:00:00"}-03:00`;
  return `${raw.replace(" ", "T")}${/[zZ]$|[+-]\d{2}:?\d{2}$/.test(raw) ? "" : "-03:00"}`;
};
export const plainText = (value: unknown) => text(value).replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();

export function trainingStatus(commission: OfficialCommission | undefined, now = new Date()): TrainingStatus {
  if (!commission) return "consultar";
  const time = now.getTime();
  const opens = localDateTime(commission.fecha_apertura_preinscripcion);
  const closes = localDateTime(commission.fecha_cierre_preinscripcion);
  const starts = localDateTime(commission.fecha_inicio);
  const finishes = localDateTime(commission.fecha_fin, true);
  if (opens && time < new Date(opens).getTime()) return "próximamente";
  if (!Number(commission.comision_cerrada) && opens && closes && time <= new Date(closes).getTime()) return "inscripción abierta";
  if (starts && time < new Date(starts).getTime()) return "inscripción cerrada";
  if (starts && finishes && time <= new Date(finishes).getTime()) return "en curso";
  if (finishes && time > new Date(finishes).getTime()) return "finalizada";
  return Number(commission.comision_cerrada) ? "inscripción cerrada" : "consultar";
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
  const days = Math.ceil(difference / 86400000);
  return days === 1 ? "Abre mañana" : `Abre en ${days} días`;
}

function opportunity(course: OfficialCourse, commission?: OfficialCommission, now = new Date()): TrainingOpportunity {
  const trainingId = text(commission?.capacitacion_id || course.capacitacion_id);
  const commissionId = commission?.id == null ? "" : text(commission.id);
  const token = text(course.token || commission?.token), slug = text(course.slug || commission?.slug);
  const rawOpening = commission?.fecha_apertura_preinscripcion || course.proxima_fecha_preinscripcion;
  const registrationOpensAt = localDateTime(rawOpening);
  const registrationHasTime = /\d{1,2}:\d{2}/.test(text(rawOpening));
  const registrationClosesAt = localDateTime(commission?.fecha_cierre_preinscripcion);
  const courseStartsAt = localDateTime(commission?.fecha_inicio);
  const courseEndsAt = localDateTime(commission?.fecha_fin, true);
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
    status: commission ? trainingStatus(commission, now) : registrationOpensAt && new Date(registrationOpensAt).getTime() > now.getTime() ? "próximamente" : "consultar", officialUrl,
    sourceUpdatedAt: text(commission?.updated_at) || null,
    metadata: {
      entity: commissionId ? "commission" : "course", trainingId, ...(commissionId ? { commissionId } : {}),
      ...(registrationOpensAt ? { registrationOpensAt, registrationHasTime } : {}), ...(registrationClosesAt ? { registrationClosesAt } : {}),
      ...(courseStartsAt ? { courseStartsAt } : {}), ...(courseEndsAt ? { courseEndsAt } : {}), source: "FDCI Tucumán", sourceUrl: officialUrl, dateStatus: "confirmed",
      ...(commission?.direccion ? { address: text(commission.direccion) } : {}),
      ...(number(commission?.cupo) != null ? { capacity: number(commission?.cupo) } : {}),
      ...(number(commission?.cupo_preinscripcion) != null ? { preCapacity: number(commission?.cupo_preinscripcion) } : {}),
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
  return result;
}

export const parseTrainingMetadata = (value: string | null | undefined): TrainingMetadata | null => {
  try { return value ? JSON.parse(value) as TrainingMetadata : null; } catch { return null; }
};
