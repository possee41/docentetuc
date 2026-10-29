import assert from "node:assert/strict";
import test from "node:test";
import { agendaDay, agendaEntries, agendaEventsOnDay, agendaInput, agendaMonthDays, manualEventDraft, manualEventPayload, shiftAgendaDay } from "./agenda-view.ts";
import type { ManualEvent, Publication, Saved } from "./types.ts";

const event: ManualEvent = { id: "synthetic", title: "Reunión", notes: "Traer documentación", category: "Escuela",
  starts_at: "2030-01-31T12:00:45.123Z", all_day: 0, recurrence: "none", reminder_minutes: 30,
  reminder_at: "2030-01-31T11:30:45.123Z", reminder_notified: 1, created_at: "2030-01-01", updated_at: "2030-01-01" };
test("Argentina: medianoche, entrada y calendario mensual sin desfases", () => {
  assert.equal(agendaDay("2030-02-01T02:59:00Z"),"2030-01-31");
  assert.equal(agendaInput("2030-02-01T03:00:00Z"),"2030-02-01T00:00");
  assert.equal(agendaDay("2030-02-01"),"2030-02-01");
  assert.equal(shiftAgendaDay("2030-01-31",1),"2030-02-01");
  assert.equal(agendaMonthDays("2028-02").filter(Boolean).length,29);
  assert.equal(agendaMonthDays("2030-02").filter(Boolean).length,28);
});
test("crear conserva descripción, horario argentino, categoría y aviso", () => {
  const form = {...manualEventDraft(null,"2030-02-01T09:15"),title:"Curso",notes:"Descripción",category:"Capacitación",reminder:"30"};
  const payload = manualEventPayload(form,null);
  assert.equal(payload.startsAt,"2030-02-01T12:15:00.000Z");
  assert.equal(payload.reminderAt,"2030-02-01T11:45:00.000Z");
  assert.equal(payload.notes,"Descripción"); assert.equal(payload.category,"Capacitación");
  assert.equal(manualEventDraft(null,"2030-02-01T09:15").title,"");
});
test("editar título preserva segundos, repetición y recordatorio preexistente sin mutar flags", () => {
  const snapshot = JSON.stringify(event);
  const payload = manualEventPayload({...manualEventDraft(event),title:"Reunión actualizada"},event);
  assert.equal(payload.id,event.id); assert.equal(payload.startsAt,event.starts_at);
  assert.equal(payload.reminderAt,event.reminder_at); assert.equal(payload.reminderMinutes,30);
  assert.equal(payload.recurrence,"none"); assert.equal(JSON.stringify(event),snapshot);
  assert.equal(manualEventPayload(manualEventDraft({...event,reminder_minutes:null}),{...event,reminder_minutes:null}).reminderMinutes,null);
});
test("todo el día y cambiar fecha mantienen la antelación sin confundir hora con UTC", () => {
  const payload = manualEventPayload({...manualEventDraft(event),allDay:true,date:"2030-02-03T09:00"},event);
  assert.equal(payload.startsAt,"2030-02-03T03:00:00.000Z");
  assert.equal(payload.reminderAt,"2030-02-03T02:30:00.000Z");
});
test("validaciones no modifican ni borran el borrador ingresado", () => {
  const form = {...manualEventDraft(null,"2030-02-01T09:00"),notes:"Conservar estas notas"};
  assert.throws(()=>manualEventPayload(form,null),/título/);
  assert.throws(()=>manualEventPayload({...form,title:"Evento",date:"2030-02-30T09:00"},null),/fecha/);
  assert.throws(()=>manualEventPayload({...form,title:"Evento",reminder:"custom",customMinutes:"0"},null),/recordatorio/);
  assert.equal(form.notes,"Conservar estas notas");
});
test("día seleccionado y recurrencias semanales/mensuales, sin duplicación ni mutación", () => {
  const manual = [event,{...event,id:"weekly",recurrence:"weekly" as const},{...event,id:"monthly",recurrence:"monthly" as const}];
  const entries = agendaEntries([],new Map(),manual);
  assert.equal(agendaEventsOnDay(entries,"2030-01-31").length,3);
  assert.equal(agendaEventsOnDay(entries,"2030-02-07").length,1);
  assert.equal(agendaEventsOnDay(entries,"2030-02-28").length,2);
  assert.equal(agendaEventsOnDay(entries,"2030-03-31").length,1);
  assert.equal(agendaEventsOnDay(entries,"2030-01-30").length,0);
  assert.equal(new Set(entries.map(e=>e.id)).size,3);
});
test("tarjetas de publicaciones preservan fecha personal, notas y recordatorio guardados", () => {
  const publication: Publication = {id:"p1",source:"Prueba local",external_id:"p1",kind:"capacitacion",category:"Capacitaciones",title:"Curso",summary:"Resumen",metadata:"",
    level:"",area:"",junta:"",location:"",shift:"",character:"",status:"consultar",official_url:"",
    starts_at:"2030-01-01",ends_at:null,first_seen_at:"2030-01-01",updated_at:"2030-01-01"};
  const saved: Saved = {publication_id:"p1",in_agenda:1,followed:0,saved_at:"2030-01-01",agenda_at:"2030-02-10T13:00:00Z",agenda_notes:"Notas propias",agenda_reminder_at:"2030-02-10T12:00:00Z",agenda_reminder_notified:0};
  const entries = agendaEntries([publication],new Map([["p1",saved]]),[event]);
  assert.equal(entries.length,2); const p = entries.find(e=>e.publication)!;
  assert.equal(p.starts_at,saved.agenda_at); assert.equal(p.notes,"Notas propias");
  assert.equal(p.category,"Capacitación"); assert.equal(p.reminderAt,saved.agenda_reminder_at);
});
