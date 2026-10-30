import type { ManualEvent, Publication, Saved } from "./types.ts";
import { eventDate, officialMetadata } from "./official-publication.ts";
import { parseTrainingMetadata } from "./training.ts";
import { htmlToText } from "./public-documents.ts";

export const agendaZone = "America/Argentina/Buenos_Aires";
export const agendaDay = (value: string | Date) => /^\d{4}-\d{2}-\d{2}$/.test(String(value)) ? String(value)
  : new Intl.DateTimeFormat("en-CA", { timeZone: agendaZone }).format(new Date(value));
export const agendaDayDate = (day: string) => new Date(`${day}T12:00:00-03:00`);
export const agendaDayLabel = (day: string) => new Intl.DateTimeFormat("es-AR",
  { timeZone: agendaZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(agendaDayDate(day));
export function agendaInput(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: agendaZone, year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value));
  const part = (name: string) => parts.find(p => p.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`;
}
export function shiftAgendaDay(day: string, amount: number) {
  const date = new Date(`${day}T12:00:00Z`); date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
export function agendaMonthDays(month: string) {
  const [year, number] = month.split("-").map(Number);
  const first = (new Date(Date.UTC(year, number - 1, 1)).getUTCDay() + 6) % 7;
  const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return Array.from({ length: Math.ceil((first + count) / 7) * 7 }, (_, i) => {
    const day = i - first + 1;
    return day > 0 && day <= count ? `${month}-${String(day).padStart(2, "0")}` : null;
  });
}
export type AgendaEntry = { id: string; title: string; category: string; starts_at: string; notes: string;
  reminderAt: string | null; reminderProcessed: boolean; allDay: boolean; manual: ManualEvent | null; publication: Publication | null };
export function agendaEntries(publications: Publication[], savedMap: Map<string, Saved>, manual: ManualEvent[]): AgendaEntry[] {
  const entries: AgendaEntry[] = manual.filter(e => Number.isFinite(Date.parse(e.starts_at))).map(e => ({
    id: `manual:${e.id}`, title: e.title, category: e.category, starts_at: e.starts_at, notes: e.notes,
    reminderAt: e.reminder_at, reminderProcessed: Boolean(e.reminder_notified), allDay: Boolean(e.all_day), manual: e, publication: null,
  }));
  for (const publication of publications) {
    const saved = savedMap.get(publication.id);
    const date = saved?.agenda_at || eventDate(publication) || parseTrainingMetadata(publication.metadata)?.registrationOpensAt || publication.ends_at || publication.starts_at;
    if (!saved?.in_agenda || officialMetadata(publication)?.canonicalId || !date || !Number.isFinite(Date.parse(date))) continue;
    entries.push({ id: `publication:${publication.id}`, title: publication.title,
      category: publication.kind === "vacante" ? "Designación" : publication.kind === "capacitacion" ? "Capacitación" : publication.category,
      starts_at: date, notes: saved.agenda_notes || htmlToText(publication.summary || ""), reminderAt: saved.agenda_reminder_at || null,
      reminderProcessed: Boolean(saved.agenda_reminder_notified), allDay: /^\d{4}-\d{2}-\d{2}$/.test(date), manual: null, publication });
  }
  return entries.sort((a,b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.id.localeCompare(b.id));
}
export function agendaEventsOnDay(events: AgendaEntry[], day: string) {
  return events.filter(event => {
    const first = agendaDay(event.starts_at), repeat = event.manual?.recurrence;
    if (!repeat || repeat === "none") return first === day;
    if (day < first) return false;
    if (repeat === "daily") return true;
    if (repeat === "weekly") return new Date(`${day}T12:00:00Z`).getUTCDay() === new Date(`${first}T12:00:00Z`).getUTCDay();
    const [year, month] = day.split("-").map(Number);
    return Number(day.slice(-2)) === Math.min(Number(first.slice(-2)), new Date(Date.UTC(year,month,0)).getUTCDate());
  }).sort((a,b) => Number(b.allDay) - Number(a.allDay) || agendaInput(a.starts_at).slice(11).localeCompare(agendaInput(b.starts_at).slice(11)) || a.id.localeCompare(b.id));
}

export type ManualEventDraft = { title: string; notes: string; date: string; category: string; allDay: boolean;
  recurrence: "none" | "daily" | "weekly" | "monthly"; reminder: string; customMinutes: string };
export function manualEventDraft(event: ManualEvent | null, initialDate = ""): ManualEventDraft {
  const minutes = event?.reminder_minutes ?? (event?.reminder_at ? Math.round((Date.parse(event.starts_at) - Date.parse(event.reminder_at)) / 60000) : null);
  const preset = minutes != null && [0,10,30,60,1440].includes(minutes);
  return { title: event?.title || "", notes: event?.notes || "", date: event ? agendaInput(event.starts_at) : initialDate || agendaInput(new Date().toISOString()),
    category: event?.category || "Personal", allDay: Boolean(event?.all_day), recurrence: event?.recurrence || "none",
    reminder: minutes == null ? "none" : preset ? String(minutes) : "custom", customMinutes: !preset && minutes != null ? String(minutes) : "15" };
}
export function manualEventPayload(draft: ManualEventDraft, event: ManualEvent | null) {
  if (!draft.title.trim()) throw new Error("Escribí un título para el evento.");
  const input = draft.allDay ? `${draft.date.slice(0,10)}T00:00` : draft.date;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) throw new Error("Elegí una fecha y hora válidas.");
  const initial = manualEventDraft(event);
  const unchangedStart = event && draft.allDay === initial.allDay &&
    (draft.allDay ? draft.date.slice(0,10) === initial.date.slice(0,10) : draft.date === initial.date);
  const starts = unchangedStart ? new Date(event.starts_at) : new Date(`${input}:00-03:00`);
  if (!Number.isFinite(starts.getTime()) || (!unchangedStart && agendaInput(starts.toISOString()) !== input)) throw new Error("Elegí una fecha y hora válidas.");
  const sameReminder = unchangedStart && draft.reminder === initial.reminder && draft.customMinutes === initial.customMinutes;
  const minutes = draft.reminder === "none" ? null : Number(draft.reminder === "custom" ? draft.customMinutes : draft.reminder);
  if (minutes !== null && (!Number.isInteger(minutes) || minutes < (draft.reminder === "custom" ? 1 : 0) || minutes > 43200))
    throw new Error("El recordatorio debe estar entre 1 y 43.200 minutos antes, o a la hora del evento.");
  return { action: "save_event", id: event?.id, title: draft.title.trim(), notes: draft.notes, category: draft.category,
    startsAt: starts.toISOString(), allDay: draft.allDay, recurrence: draft.recurrence,
    reminderMinutes: sameReminder ? event.reminder_minutes ?? null : minutes,
    reminderAt: sameReminder ? event.reminder_at || undefined : minutes == null ? undefined : new Date(starts.getTime() - minutes*60000).toISOString() };
}
