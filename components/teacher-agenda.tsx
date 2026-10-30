"use client";

import { useMemo, useRef, useState } from "react";
import { Bell, CalendarDays, ChevronLeft, ChevronRight, Clock3, Pencil, Plus, Repeat2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { agendaDay, agendaDayDate, agendaDayLabel, agendaEntries, agendaEventsOnDay, agendaInput, agendaMonthDays, agendaZone,
  manualEventDraft, manualEventPayload, shiftAgendaDay } from "@/lib/agenda-view";
import type { AgendaEntry, ManualEventDraft } from "@/lib/agenda-view";
import type { ManualEvent, Publication, Saved } from "@/lib/types";

const repeatLabels = { none: "No se repite", daily: "Todos los días", weekly: "Todas las semanas", monthly: "Todos los meses" };
const categories = ["Personal", "Escuela", "Designación", "Capacitación", "Trámite", "Recordatorio"];
const reminderLabel = (at: string) => new Intl.DateTimeFormat("es-AR", {
  timeZone: agendaZone, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).format(new Date(at));

function AgendaEventCard({ entry, day, onOpen }: { entry: AgendaEntry; day: string; onOpen: () => void }) {
  return <button type="button" className="agenda-ui-card" onClick={onOpen} aria-label={`Ver evento: ${entry.title}`}>
    <span className="agenda-ui-date"><strong>{Number(day.slice(-2))}</strong><small>{new Intl.DateTimeFormat("es-AR", { month: "short", timeZone: agendaZone }).format(agendaDayDate(day))}</small></span>
    <span className="agenda-ui-card-copy">
      <span className="agenda-ui-category">{entry.category || "Evento"}{entry.manual?.recurrence && entry.manual.recurrence !== "none" && <><Repeat2 className="size-3.5" />{repeatLabels[entry.manual.recurrence]}</>}</span>
      <strong className="agenda-ui-title">{entry.title}</strong>
      <span className="agenda-ui-meta"><Clock3 className="size-3.5" />{entry.allDay ? "Todo el día" : `${agendaInput(entry.starts_at).slice(11)} h`}
        <span>· {new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric", timeZone: agendaZone }).format(agendaDayDate(day))}</span></span>
      {entry.notes && <span className="agenda-ui-notes">{entry.notes}</span>}
      {entry.reminderAt && <span className="agenda-ui-reminder"><Bell className="size-3.5 shrink-0" /><span>{entry.reminderProcessed ? "Recordatorio procesado" : "Recordatorio configurado"} · {reminderLabel(entry.reminderAt)}</span></span>}
    </span><ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" />
  </button>;
}

export function Agenda({ publications, savedMap, manualEvents, focusAt, onOpen, onNewEvent, onEditEvent }: {
  publications: Publication[]; savedMap: Map<string, Saved>; manualEvents: ManualEvent[]; focusAt: string;
  onOpen: (item: Publication) => void; onNewEvent: (date?: string) => void; onEditEvent: (event: ManualEvent) => void;
}) {
  const today = agendaDay(new Date());
  const [mode, setMode] = useState<"month" | "week" | "agenda">("month");
  const initialDay = focusAt ? agendaDay(focusAt) : today;
  const [position, setPosition] = useState({ day: initialDay, month: initialDay.slice(0,7), focusAt });
  const [category, setCategory] = useState("todas");
  const selected = focusAt && focusAt !== position.focusAt ? agendaDay(focusAt) : position.day;
  const month = focusAt && focusAt !== position.focusAt ? selected.slice(0,7) : position.month;
  const all = useMemo(() => agendaEntries(publications, savedMap, manualEvents), [publications, savedMap, manualEvents]);
  const events = all.filter(e => category === "todas" || e.category === category);
  const selectedEvents = agendaEventsOnDay(events, selected);
  const weekday = (new Date(`${selected}T12:00:00Z`).getUTCDay() + 6) % 7;
  const week = Array.from({ length: 7 }, (_, i) => shiftAgendaDay(selected, i - weekday));
  const choose = (day: string) => setPosition({ day, month: day.slice(0,7), focusAt });
  const create = () => onNewEvent(`${selected}T09:00`);
  const changeMonth = (delta: number) => {
    const [year, number] = month.split("-").map(Number);
    setPosition({ day: selected, month: new Date(Date.UTC(year,number - 1 + delta,1)).toISOString().slice(0,7), focusAt });
  };
  const card = (entry: AgendaEntry, day = agendaDay(entry.starts_at)) => <AgendaEventCard key={`${entry.id}:${day}`} entry={entry} day={day}
    onOpen={() => entry.manual ? onEditEvent(entry.manual) : entry.publication && onOpen(entry.publication)} />;
  const empty = (title: string, description: string) => <div className="agenda-ui-empty"><CalendarDays className="mx-auto mb-2 size-7 text-[var(--accent-text)]" />
    <h3 className="font-bold">{title}</h3><p className="mt-1 text-sm text-[var(--text-secondary)]">{description}</p>
    <Button type="button" variant="outline" onClick={create} className="mt-4 min-h-11 rounded-xl"><Plus className="size-4" />Crear evento</Button></div>;
  const dayButton = (day: string, compact = false) => {
    const count = agendaEventsOnDay(events, day).length;
    return <button type="button" key={day} className={`agenda-ui-day ${day === today ? "is-today" : ""} ${day === selected ? "is-selected" : ""}`}
      aria-pressed={day === selected} aria-current={day === today ? "date" : undefined}
      aria-label={`${agendaDayLabel(day)} · ${count} ${count === 1 ? "evento" : "eventos"}`} onClick={() => choose(day)}>
      {compact && <span className="agenda-ui-weekday">{["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"][(new Date(`${day}T12:00:00Z`).getUTCDay()+6)%7]}</span>}
      <strong>{Number(day.slice(-2))}</strong>{count > 0 && <span className="agenda-ui-count" aria-hidden="true">{count > 99 ? "99+" : count}</span>}
    </button>;
  };
  return <section className="agenda-ui min-w-0 space-y-4 pb-4" aria-label="Agenda docente">
    <header className="agenda-ui-header"><div className="flex min-w-0 items-center gap-3"><span className="agenda-ui-header-icon"><CalendarDays className="size-6" /></span>
      <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-wider text-[var(--accent-text)]">Tu organización personal</p><h1 className="text-xl font-black sm:text-2xl">Agenda docente</h1><p className="mt-1 text-sm text-[var(--text-secondary)]">Tus fechas, actividades y recordatorios.</p></div></div>
      <Button type="button" onClick={create} className="min-h-11 shrink-0 rounded-xl bg-[#0878be] px-4 text-white hover:bg-[#0866a0]"><Plus className="size-4" />Evento</Button></header>
    <div className="agenda-ui-tabs" aria-label="Vistas de Agenda">{([["month","Mes"],["week","Semana"],["agenda","Agenda"]] as const).map(([value,label]) =>
      <button key={value} type="button" aria-pressed={mode === value} onClick={() => setMode(value)} className={mode === value ? "is-active" : ""}>{label}</button>)}</div>
    <div className="flex flex-wrap items-center gap-2"><Label htmlFor="agenda-category" className="text-sm text-[var(--text-secondary)]">Mostrar</Label>
      <select id="agenda-category" value={category} onChange={e => setCategory(e.target.value)} className="agenda-ui-select min-w-0 flex-1 sm:flex-none">
        <option value="todas">Todos los eventos</option>{categories.map(c => <option key={c} value={c}>{c === "Designación" ? "Designaciones" : c}</option>)}</select>
      <Button type="button" variant="outline" onClick={() => choose(today)} className="min-h-11 rounded-xl sm:ml-auto">Hoy</Button></div>
    {mode !== "agenda" && <section className={`agenda-ui-calendar${mode === "month" ? " agenda-ui-calendar--classroom" : ""}`}>
      <div className="agenda-ui-calendar-heading"><Button type="button" variant="ghost" size="icon" aria-label={mode === "month" ? "Mes anterior" : "Semana anterior"} onClick={() => mode === "month" ? changeMonth(-1) : choose(shiftAgendaDay(selected,-7))}><ChevronLeft className="size-5" /></Button>
        <h2 className="min-w-0 text-center text-base font-black capitalize">{mode === "month" ? new Intl.DateTimeFormat("es-AR", { timeZone: agendaZone, month: "long", year: "numeric" }).format(agendaDayDate(`${month}-01`)) : `${new Intl.DateTimeFormat("es-AR", { timeZone: agendaZone, day: "numeric", month: "short" }).format(agendaDayDate(week[0]))} – ${new Intl.DateTimeFormat("es-AR", { timeZone: agendaZone, day: "numeric", month: "short", year: "numeric" }).format(agendaDayDate(week[6]))}`}</h2>
        <Button type="button" variant="ghost" size="icon" aria-label={mode === "month" ? "Mes siguiente" : "Semana siguiente"} onClick={() => mode === "month" ? changeMonth(1) : choose(shiftAgendaDay(selected,7))}><ChevronRight className="size-5" /></Button></div>
      <div className="agenda-ui-calendar-grid">{mode === "month" ? <>{["Lun","Mar","Mié","Jue","Vie","Sáb","Dom"].map(d => <span key={d} className="agenda-ui-weekday py-2">{d}</span>)}
        {agendaMonthDays(month).map((day,i) => day ? dayButton(day) : <span key={`blank:${i}`} />)}</> : week.map(d => dayButton(d,true))}</div>
    </section>}
    {mode === "month" && <section aria-label="Eventos del día seleccionado" className="space-y-3"><div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="font-bold capitalize">{agendaDayLabel(selected)}</h2><span className="text-xs font-semibold text-[var(--text-muted)]">{selectedEvents.length} {selectedEvents.length === 1 ? "evento" : "eventos"}</span></div>
      {selectedEvents.length ? selectedEvents.map(e => card(e,selected)) : empty("Este día está libre", "Elegí otra fecha o agregá una actividad para este día.")}</section>}
    {mode === "week" && <section aria-label="Eventos de la semana" className="space-y-4">{week.some(d => agendaEventsOnDay(events,d).length) ? week.map(day => {
      const items = agendaEventsOnDay(events,day); return items.length ? <div key={day} className="space-y-2"><h3 className={`agenda-ui-group-heading ${day === selected ? "is-selected" : ""}`}>{agendaDayLabel(day)}</h3>{items.map(e => card(e,day))}</div> : null;
    }) : empty("Una semana por organizar", "Todavía no tenés actividades en estos días.")}</section>}
    {mode === "agenda" && <section aria-label="Lista de eventos" className="space-y-4">{events.length ? events.map((entry,i) => <div key={entry.id} className="space-y-2">
      {(i === 0 || agendaDay(events[i-1].starts_at) !== agendaDay(entry.starts_at)) && <h3 className={`agenda-ui-group-heading ${agendaDay(entry.starts_at) === selected ? "is-selected" : ""}`}>{agendaDayLabel(agendaDay(entry.starts_at))}</h3>}{card(entry)}</div>)
      : empty(category === "todas" ? "Tu agenda está lista para empezar" : "Sin eventos de esta categoría", "Agregá tu primera actividad o cambiá el filtro.")}</section>}
  </section>;
}

export function ManualEventDialog({ event, initialDate, headers, onClose, onSaved }: {
  event: ManualEvent | null; initialDate: string; headers: () => HeadersInit; onClose: () => void; onSaved: (startsAt?: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(!event), [form, setForm] = useState(() => manualEventDraft(event,initialDate));
  const [busy,setBusy] = useState(false), [error,setError] = useState("");
  const pending = useRef(false);
  const draftId = useRef<string | undefined>(undefined);
  const field = <K extends keyof ManualEventDraft>(key: K, value: ManualEventDraft[K]) => setForm(current => ({...current,[key]:value}));
  async function save() {
    if (pending.current) return;
    setError("");
    let payload: ReturnType<typeof manualEventPayload>;
    try { payload = manualEventPayload(form,event); } catch (e) { setError(e instanceof Error ? e.message : "Revisá los datos del evento."); return; }
    // Reuse the same ID if a successful write loses its HTTP response.
    if (!event) { draftId.current ??= crypto.randomUUID(); payload.id = draftId.current; }
    pending.current = true; setBusy(true);
    try {
      const response = await fetch("/api/app", { method: "POST", headers: headers(), body: JSON.stringify(payload) });
      const result = await response.json().catch(() => null) as { ok?: boolean; error?: string } | null;
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || "No se pudo guardar el evento. Tus datos siguen en el formulario.");
      toast.success(event ? "Evento actualizado" : "Evento guardado en Agenda"); await onSaved(payload.startsAt);
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo conectar. Tus datos siguen en el formulario."); }
    finally { pending.current = false; setBusy(false); }
  }
  async function remove() {
    if (!event || pending.current || !confirm("¿Eliminar este evento de la Agenda? Esta acción no se puede deshacer.")) return;
    pending.current = true; setBusy(true); setError("");
    try {
      const response = await fetch("/api/app", { method: "POST", headers: headers(), body: JSON.stringify({action:"delete_event",id:event.id}) });
      const result = await response.json().catch(() => null) as {ok?: boolean; error?: string} | null;
      if (!response.ok || result?.ok !== true) throw new Error(result?.error || "No se pudo eliminar el evento.");
      toast.success("Evento eliminado"); await onSaved();
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo conectar. El evento sigue guardado."); }
    finally { pending.current = false; setBusy(false); }
  }
  const choice = (key: "category" | "recurrence" | "reminder", label: string, options: [string,string][]) => <div className="space-y-2"><Label htmlFor={`agenda-event-${key}`}>{label}</Label>
    <Select value={form[key]} onValueChange={value => value && field(key,value as typeof form[typeof key])}><SelectTrigger id={`agenda-event-${key}`} className="min-h-11 w-full rounded-xl"><SelectValue /></SelectTrigger>
      <SelectContent>{options.map(([value,text]) => <SelectItem key={value} value={value}>{text}</SelectItem>)}</SelectContent></Select></div>;
  return <Dialog open onOpenChange={open => !open && !pending.current && onClose()}><DialogContent className="agenda-ui-dialog z-[90] flex max-h-[calc(100dvh-2rem)] flex-col overflow-hidden sm:max-w-xl">
    <DialogHeader className="shrink-0"><DialogTitle className="flex items-center gap-2 text-[var(--text-primary)]"><CalendarDays className="size-5 shrink-0 text-[var(--accent-text)]" />{editing ? event ? "Editar evento" : "Nuevo evento" : "Detalle del evento"}</DialogTitle>
      <DialogDescription>{editing ? "Organizá tu actividad. Los horarios se muestran en hora de Argentina." : "Esta es la información guardada en tu Agenda personal."}</DialogDescription></DialogHeader>
    {!editing && event ? <div className="min-h-0 space-y-4 overflow-y-auto break-words text-[var(--text-primary)]">
      <div><span className="agenda-ui-category">{event.category}</span><h2 className="mt-2 text-xl font-black">{event.title}</h2></div>
      <div className="agenda-ui-detail"><CalendarDays className="size-5 shrink-0 text-[var(--accent-text)]" /><div><strong className="block capitalize">{agendaDayLabel(agendaDay(event.starts_at))}</strong><span>{event.all_day ? "Todo el día" : `${agendaInput(event.starts_at).slice(11)} h · Argentina`}</span></div></div>
      {event.notes && <div className="space-y-1"><h3 className="text-sm font-bold text-[var(--text-secondary)]">Descripción</h3><p className="whitespace-pre-wrap text-sm leading-relaxed">{event.notes}</p></div>}
      <div className="agenda-ui-detail"><Bell className="size-5 shrink-0 text-[var(--accent-text)]" /><div><strong className="block text-sm">{event.reminder_at ? "Recordatorio configurado" : "Sin recordatorio"}</strong>{event.reminder_at && <><span className="text-sm">{reminderLabel(event.reminder_at)} · Argentina</span><small className="mt-1 block text-[var(--text-muted)]">{event.reminder_notified ? "Procesado; no equivale a una entrega push confirmada." : "Pendiente de procesamiento."}</small></>}</div></div>
      <p className="flex items-center gap-2 text-sm text-[var(--text-secondary)]"><Repeat2 className="size-4" />{repeatLabels[event.recurrence || "none"]}</p>
      {error && <p role="alert" className="agenda-ui-error">{error}</p>}
      <DialogFooter><Button variant="outline" onClick={onClose}>Cerrar</Button><Button onClick={() => setEditing(true)} className="min-h-11 bg-[#0878be] text-white"><Pencil className="size-4" />Editar evento</Button></DialogFooter>
    </div> : <form onSubmit={e => {e.preventDefault();void save();}} noValidate className="flex min-h-0 flex-col gap-4">
      <div data-agenda-fields className="min-h-0 overflow-y-auto pr-1"><fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
        <div className="space-y-2"><Label htmlFor="agenda-event-title">Título</Label><Input id="agenda-event-title" value={form.title} onChange={e => field("title",e.target.value)} maxLength={160} placeholder="Ej. Reunión de padres" className="h-11 rounded-xl" required /></div>
        <div className="space-y-2"><Label htmlFor="agenda-event-notes">Descripción / notas</Label><Textarea id="agenda-event-notes" value={form.notes} onChange={e => field("notes",e.target.value)} maxLength={1000} placeholder="Detalles que quieras recordar" className="min-h-24 rounded-xl" /></div>
        <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] p-3"><Label htmlFor="agenda-event-all-day">Todo el día</Label><Switch id="agenda-event-all-day" checked={form.allDay} onCheckedChange={value => field("allDay",value)} /></div>
        <div className="space-y-2"><Label htmlFor="agenda-event-date">{form.allDay ? "Fecha" : "Fecha y hora · Argentina"}</Label><Input id="agenda-event-date" type={form.allDay ? "date" : "datetime-local"} value={form.allDay ? form.date.slice(0,10) : form.date}
          onChange={e => field("date",form.allDay ? `${e.target.value}T${form.date.slice(11) || "09:00"}` : e.target.value)} className="h-11 min-w-0 rounded-xl" required /></div>
        {choice("category","Categoría",Array.from(new Set([form.category,...categories])).map(c => [c,c]))}
        {choice("recurrence","Repetir",Object.entries(repeatLabels))}
        {choice("reminder","Recordarme",[["none","Sin recordatorio"],["0","A la hora del evento"],["10","10 minutos antes"],["30","30 minutos antes"],["60","1 hora antes"],["1440","1 día antes"],["custom","Personalizado"]])}
        {form.reminder === "custom" && <div className="space-y-2"><Label htmlFor="agenda-event-minutes">Minutos antes</Label><Input id="agenda-event-minutes" type="number" min="1" max="43200" value={form.customMinutes} onChange={e => field("customMinutes",e.target.value)} className="h-11 rounded-xl" /></div>}
      </fieldset></div>
      <p data-agenda-reminder-help className="shrink-0 text-xs leading-relaxed text-[var(--text-muted)]">El recordatorio queda configurado; su entrega depende de los avisos habilitados. Guardarlo no activa notificaciones push.</p>
      {error && <p role="alert" className="agenda-ui-error shrink-0">{error}</p>}
      <DialogFooter className="shrink-0 gap-2">{event && <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()} className="min-h-11 text-[var(--danger-text)] sm:mr-auto"><Trash2 className="size-4" />Eliminar</Button>}
        <Button type="button" variant="outline" disabled={busy} onClick={onClose} className="min-h-11">Cancelar</Button><Button type="submit" disabled={busy} className="min-h-11 rounded-xl bg-[#0878be] text-white">{busy ? "Guardando…" : "Guardar evento"}</Button></DialogFooter>
    </form>}
  </DialogContent></Dialog>;
}
