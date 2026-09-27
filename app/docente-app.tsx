"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Bell, BookOpen, Bookmark, BriefcaseBusiness, CalendarDays, ChevronRight, Clock3, Download, ExternalLink, GraduationCap, Home, Menu, Moon, RefreshCw, Search, SlidersHorizontal, Sparkles, Star, Sun, UserRound, WifiOff, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Toaster } from "@/components/ui/sonner";
import { AppBackground, DocenteTucAIFab } from "@/components/app-chrome";
import type { AIContext } from "@/components/app-chrome";
import { DocenteTucAIChatPanel } from "@/components/docentetuc-ai-panel";
import type { AIAssistantAction } from "@/components/docentetuc-ai-panel";
import { toast } from "sonner";
import { matchesProfile, profileMatch } from "@/lib/matching";
import type { MatchResult } from "@/lib/matching";
import { safeDate } from "@/lib/safe-date";
import { openingCountdown, parseTrainingMetadata } from "@/lib/training";
import { calendarDayDistance, compareHomePriority, homePriority } from "@/lib/home-dashboard";
import { DESIGNATION_STATUSES, designationFacts } from "@/lib/designations";
import type { DesignationTracking } from "@/lib/types";
import type { AppData, Profile, Publication, Saved, TrainingReminder } from "@/lib/types";

type View = "inicio" | "vacantes" | "capacitaciones" | "junta" | "agenda" | "alertas" | "guardados" | "perfil";
type Theme = "light" | "dark";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const navigation: [View, string, typeof Home][] = [
  ["inicio", "Inicio", Home], ["vacantes", "Designaciones", BriefcaseBusiness], ["capacitaciones", "Capacitaciones", GraduationCap],
  ["junta", "Padrones y comunicados", BookOpen], ["agenda", "Agenda", CalendarDays], ["alertas", "Alertas", Bell], ["guardados", "Mis guardados", Bookmark], ["perfil", "Perfil", UserRound],
];
const viewTitles: Record<View, [string, string]> = {
  inicio: ["Inicio", "Lo más relevante según tus preferencias"], vacantes: ["Designaciones", "Pedidos de cobertura publicados en SIME"],
  capacitaciones: ["Capacitaciones", "Propuestas oficiales de formación docente"], junta: ["Padrones y comunicados", "Llamados abiertos, padrones, comunicados y documentación oficial"],
  agenda: ["Agenda docente", "Fechas y vencimientos de las publicaciones"], alertas: ["Alertas", "Novedades detectadas sin duplicados"],
  guardados: ["Mis guardados", "Publicaciones que elegiste conservar"], perfil: ["Tu perfil docente", "Preferencias usadas para ordenar la información"],
};
const SIME_LOGIN = "https://sime.educaciontuc.gov.ar/Login/Login";
const FDCI_LOGIN = "https://capacitaciondocente.educaciontuc.gov.ar/docentes";
const EDUCATION_LEVELS = ["Inicial", "Primario", "Secundario", "Superior"];

function AppSidebarNavigation({ view, unread, onNavigate }: { view: View; unread: number; onNavigate: (view: View) => void }) {
  const { setOpen, setOpenMobile } = useSidebar();
  return <SidebarMenu>{navigation.map(([id, label, Icon]) => <SidebarMenuItem key={id}><SidebarMenuButton isActive={view === id} onClick={() => { onNavigate(id); setOpen(false); setOpenMobile(false); }} className="h-11 rounded-xl bg-white/8 px-3 font-semibold text-white hover:bg-white/15 hover:text-white data-[active=true]:bg-[#2eb6f3] data-[active=true]:font-black data-[active=true]:text-white"><Icon className="size-5" /><span>{label}</span>{id === "alertas" && unread > 0 && <Badge className="ml-auto bg-[#f4b942] text-[#062b55]">{unread}</Badge>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu>;
}

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const publicationLabel = (item: Publication) => item.kind === "vacante" ? (normalize(item.category).includes("llamado") ? "LLAMADO ABIERTO" : "DESIGNACIÓN") : item.kind === "capacitacion" ? "CAPACITACIÓN" : item.category.toUpperCase();
const publicationSearchText = (item: Publication) => [item.title, item.summary, item.level, item.area, item.junta, item.location, item.character, item.category, item.source, item.kind === "vacante" ? "designaciones vacantes" : "", Date.now() - new Date(`${item.updated_at}Z`).getTime() < 30 * 864e5 ? "novedades" : ""].join(" ");
const apiHeaders = (json = false) => {
  let deviceId = localStorage.getItem("docentetuc-device-id");
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("docentetuc-device-id", deviceId); }
  return { "X-DocenteTuc-Device": deviceId, ...(json ? { "Content-Type": "application/json" } : {}) };
};
const dateLabel = (value: string | null, withTime = false) => { const date = safeDate(value); return date ? new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date) : "Sin fecha informada"; };
const fromNow = (value: string | null) => {
  const date = safeDate(value); if (!date) return "Sin fecha informada"; const hours = Math.ceil((date.getTime() - Date.now()) / 36e5);
  return hours <= 0 ? "Finalizó" : hours < 24 ? `Vence en ${hours} h` : `Vence en ${Math.ceil(hours / 24)} días`;
};
const tucumanDay = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(typeof value === "string" ? new Date(value) : value);
const opensToday = (item: Publication) => { const opens = parseTrainingMetadata(item.metadata)?.registrationOpensAt; return Boolean(opens && tucumanDay(opens) === tucumanDay(new Date())); };

export default function DocenteApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<View>("inicio");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("para-mi");
  const [level, setLevel] = useState("todos");
  const [character, setCharacter] = useState("todos");
  const [trainingArea, setTrainingArea] = useState("todas");
  const [trainingLocation, setTrainingLocation] = useState("todos");
  const [trainingDate, setTrainingDate] = useState("");
  const [selected, setSelected] = useState<Publication | null>(null);
  const [reminderPublication, setReminderPublication] = useState<Publication | null>(null);
  const [reminderMode, setReminderMode] = useState("one_day");
  const [customReminder, setCustomReminder] = useState("");
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sourceWarning, setSourceWarning] = useState("");
  const [offline, setOffline] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [aiOpen, setAIOpen] = useState(false);
  const [aiContext, setAIContext] = useState<AIContext>({ type: "inicio", title: viewTitles.inicio[0] });
  const [returnPublication, setReturnPublication] = useState<Publication | null>(null);
  const [trackingPublication, setTrackingPublication] = useState<Publication | null>(null);

  const load = async (syncIfEmpty = true) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/app", { cache: "no-store", headers: apiHeaders() });
      if (!response.ok) throw new Error("No se pudo cargar la información");
      const result = await response.json() as AppData;
      result.designations ||= []; if (result.profile) result.profile.roles ||= [];
      setData(result);
      localStorage.setItem("docentetuc-data-v1", JSON.stringify(result));
      if (syncIfEmpty && result.publications.length === 0) await syncSources(false);
    } catch (error) { const cached = localStorage.getItem("docentetuc-data-v1"); if (cached) { try { const stored = JSON.parse(cached) as AppData; stored.designations ||= []; if (stored.profile) stored.profile.roles ||= []; setData(stored); setSourceWarning("Mostrando la última información guardada en este dispositivo."); return; } catch {} } const message = error instanceof Error ? error.message : "No se pudo cargar la información"; setLoadError(message); toast.error(message); }
    finally { setLoading(false); }
  };

  const syncSources = async (notify = true) => {
    setSyncing(true);
    setSourceWarning("");
    try {
      const response = await fetch("/api/sync", { method: "POST", headers: apiHeaders() });
      const result = await response.json() as { error?: string; skipped?: boolean; count?: number; failures?: number };
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar");
      if (result.failures) setSourceWarning("No pudimos actualizar todas las fuentes. El resto de la aplicación sigue disponible.");
      if (notify) result.failures ? toast.warning("Algunas fuentes oficiales no respondieron") : toast.success(result.skipped ? "Las fuentes ya estaban actualizadas" : `${result.count ?? 0} publicaciones verificadas`);
      await load(false);
    } catch (error) { const message = error instanceof Error ? error.message : "No se pudo actualizar"; setSourceWarning(message); if (notify) toast.error(message); }
    finally { setSyncing(false); }
  };

  useEffect(() => {
    const preferred = localStorage.getItem("docentetuc-theme") as Theme | null;
    const initial = preferred || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial); document.documentElement.dataset.theme = initial;
    void load();
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    const updateNetwork = () => setOffline(!navigator.onLine); updateNetwork();
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    window.addEventListener("online", updateNetwork); window.addEventListener("offline", updateNetwork); window.addEventListener("beforeinstallprompt", install);
    return () => { window.removeEventListener("online", updateNetwork); window.removeEventListener("offline", updateNetwork); window.removeEventListener("beforeinstallprompt", install); };
  }, []);

  useEffect(() => {
    if (!data) return;
    const id = new URLSearchParams(location.search).get("publication");
    const publication = id ? data.publications.find((item) => item.id === id) : null;
    if (!publication) return;
    setSelected(publication);
    setView(publication.kind === "vacante" ? "vacantes" : publication.kind === "capacitacion" ? "capacitaciones" : "junta");
    history.replaceState(null, "", location.pathname);
  }, [data]);

  useEffect(() => {
    if (!data) return;
    const checkReturn = () => { const id = localStorage.getItem("docentetuc-pending-designation"); if (id) setReturnPublication(data.publications.find((item) => item.id === id) || null); };
    checkReturn(); window.addEventListener("focus", checkReturn); return () => window.removeEventListener("focus", checkReturn);
  }, [data]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    void Promise.resolve(context.registerTool({ name: "search_publications", title: "Buscar publicaciones", description: "Busca designaciones, vacantes, capacitaciones, llamados abiertos, padrones, comunicados y novedades visibles en DocenteTuc.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input: unknown) { const term = typeof input === "object" && input && "query" in input ? String((input as { query: unknown }).query) : ""; setQuery(term); setView("inicio"); return { query: term, visibleResults: filteredPublications(term).length }; } }, { signal: controller.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({ name: "open_teacher_profile", title: "Abrir perfil docente", description: "Abre el formulario de preferencias del perfil docente.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute() { setView("perfil"); return { opened: true }; } }, { signal: controller.signal })).catch(() => undefined);
    return () => controller.abort();
  }, [data]);

  const savedMap = useMemo(() => new Map((data?.saved || []).map((item) => [item.publication_id, item])), [data]);
  const reminderMap = useMemo(() => new Map((data?.reminders || []).map((item) => [item.training_id, item])), [data]);
  const profile = data?.profile;
  const matchProfile = profile ? { levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards, roles: profile.roles, department: profile.department, locality: profile.locality, shifts: profile.shifts, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests } : null;
  const publicationForMatch = (publication: Publication) => ({ kind: publication.kind, title: publication.title, summary: publication.summary, level: publication.level, area: publication.area, junta: publication.junta, location: publication.location, shift: publication.shift, character: publication.character });
  const matchResult = (publication: Publication) => matchProfile ? profileMatch(publicationForMatch(publication), matchProfile) : { status: "unconfigured", score: 0, matched: 0, total: 0, criteria: [] } as MatchResult;
  const matches = (publication: Publication) => matchProfile ? matchesProfile(publicationForMatch(publication), matchProfile) : false;

  function filteredPublications(search = query) {
    let items = data?.publications || [];
    if (view === "vacantes") items = items.filter((item) => item.kind === "vacante");
    if (view === "capacitaciones") items = items.filter((item) => item.kind === "capacitacion");
    if (view === "junta") items = items.filter((item) => item.kind === "junta");
    if (view === "guardados") items = items.filter((item) => savedMap.has(item.id));
    if (filter === "para-mi") items = items.filter(matches);
    if (filter === "abiertas") items = items.filter((item) => item.status === "inscripción abierta");
    if (filter === "proximamente") items = items.filter((item) => item.status === "próximamente");
    if (filter === "hoy") items = items.filter(opensToday);
    if (filter === "guardadas") items = items.filter((item) => savedMap.has(item.id));
    if (filter === "llamados") items = items.filter((item) => normalize(item.category).includes("llamado"));
    if (filter === "padrones") items = items.filter((item) => normalize(item.category).includes("padron"));
    if (filter === "comunicados") items = items.filter((item) => normalize(item.category).includes("comunicado"));
    if (filter === "nuevas") items = items.filter((item) => Date.now() - new Date(`${item.first_seen_at}Z`).getTime() < 7 * 864e5);
    if (filter === "por-vencer") items = items.filter((item) => item.ends_at && new Date(item.ends_at).getTime() > Date.now() && new Date(item.ends_at).getTime() - Date.now() < 3 * 864e5);
    if (level !== "todos") items = items.filter((item) => normalize(item.level + item.junta).includes(normalize(level)));
    if (character !== "todos") items = items.filter((item) => normalize(item.character).includes(normalize(character)));
    if (view === "capacitaciones" && trainingArea !== "todas") items = items.filter((item) => normalize(item.area).includes(normalize(trainingArea)));
    if (view === "capacitaciones" && trainingLocation !== "todos") items = items.filter((item) => item.location === trainingLocation);
    if (view === "capacitaciones" && trainingDate) items = items.filter((item) => item.starts_at?.slice(0, 10) === trainingDate || parseTrainingMetadata(item.metadata)?.registrationClosesAt?.slice(0, 10) === trainingDate);
    if (search.trim()) { const term = normalize(search); items = items.filter((item) => normalize(publicationSearchText(item)).includes(term)); }
    if (view === "capacitaciones") items = [...items].sort((a, b) => Number(opensToday(b)) - Number(opensToday(a)) || Number(b.status === "próximamente") - Number(a.status === "próximamente") || Number(b.status === "inscripción abierta") - Number(a.status === "inscripción abierta") || new Date(parseTrainingMetadata(a.metadata)?.registrationOpensAt || "9999").getTime() - new Date(parseTrainingMetadata(b.metadata)?.registrationOpensAt || "9999").getTime());
    return items;
  }

  const mutateSaved = async (action: "save" | "agenda" | "follow", publication: Publication, enabled: boolean) => {
    setData((current) => {
      if (!current) return current;
      const existing = current.saved.find((item) => item.publication_id === publication.id);
      let saved = current.saved.filter((item) => item.publication_id !== publication.id);
      if (action !== "save" || enabled) saved = [...saved, { publication_id: publication.id, in_agenda: action === "agenda" ? enabled : existing?.in_agenda || false, followed: action === "follow" ? enabled : existing?.followed || false, saved_at: existing?.saved_at || new Date().toISOString() }];
      return { ...current, saved };
    });
    const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action, publicationId: publication.id, enabled }) });
    if (!response.ok) { toast.error("No se pudo guardar el cambio"); await load(false); } else toast.success(action === "save" ? (enabled ? "Guardado" : "Quitado de guardados") : action === "agenda" ? "Agenda actualizada" : "Seguimiento actualizado");
  };

  const saveReminder = async () => {
    if (!reminderPublication) return;
    const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "set_training_reminder", publicationId: reminderPublication.id, mode: reminderMode, customRemindAt: reminderMode === "custom" && customReminder ? new Date(customReminder).toISOString() : undefined }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return toast.error(result.error || "No se pudo crear el recordatorio");
    toast.success("Recordatorio activado"); setReminderPublication(null); await load(false);
  };

  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === "accepted") setInstallPrompt(null); };
  const toggleTheme = () => setTheme((current) => { const next = current === "dark" ? "light" : "dark"; localStorage.setItem("docentetuc-theme", next); document.documentElement.dataset.theme = next; return next; });
  const openAI = (context: AIContext) => { setAIContext(context); setSelected(null); setAIOpen(true); };
  const runAIAction = async (action: AIAssistantAction, context: AIContext) => {
    const publication = data?.publications.find((item) => item.id === context.id);
    if (!publication) throw new Error("Publicación no encontrada");
    if (action === "remind") { if (publication.kind === "vacante") setTrackingPublication(publication); else setReminderPublication(publication); return; }
    await mutateSaved(action, publication, true);
  };
  const unread = data?.notifications.filter((notice) => !Boolean(notice.read)).length || 0;
  const items = filteredPublications();
  const levels = [...new Set((data?.publications || []).map((item) => item.level || item.junta).filter(Boolean))].slice(0, 12);
  const trainingAreas = [...new Set((data?.publications || []).filter((item) => item.kind === "capacitacion").flatMap((item) => item.area.split(",")).map((item) => item.trim()).filter(Boolean))].slice(0, 30);
  const trainingLocations = [...new Set((data?.publications || []).filter((item) => item.kind === "capacitacion").map((item) => item.location).filter(Boolean))].slice(0, 30);
  const trainingSync = data?.sync.find((item) => item.source === "Capacitación Docente");
  const designationMap = new Map((data?.designations || []).map((item) => [item.publication_id, item]));
  const roleOptions = [...new Set((data?.publications || []).filter((item) => item.kind === "vacante").map((item) => designationFacts(item).role).filter(Boolean))].slice(0, 80);
  const openDesignationOfficial = (item: Publication) => { localStorage.setItem("docentetuc-pending-designation", item.id); window.open(item.official_url, "_blank", "noopener,noreferrer"); };
  const greeting = new Date().getHours() < 12 ? "Buenos días" : new Date().getHours() < 20 ? "Buenas tardes" : "Buenas noches";
  return (
    <SidebarProvider defaultOpen={false} className="mobile-preview-shell" style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      <Sidebar className="border-r border-white/10 text-white backdrop-blur-xl" collapsible="offcanvas">
        <SidebarHeader className="p-5"><button onClick={() => setView("inicio")} className="flex items-center gap-3 text-left"><img src="/icon-192.png" alt="" className="size-12 rounded-2xl shadow-sm" /><span><span className="block text-xl font-black">DocenteTuc</span><span className="block text-xs text-white/55">Información docente</span></span></button></SidebarHeader>
        <SidebarContent className="px-3"><AppSidebarNavigation view={view} unread={unread} onNavigate={(id) => { setView(id); setQuery(""); setFilter(id === "capacitaciones" ? "proximamente" : id === "guardados" ? "todas" : "para-mi"); }} /></SidebarContent>
        <SidebarFooter className="p-5"><p className="text-xs leading-relaxed text-white/45">Herramienta independiente. La fuente oficial prevalece siempre.</p></SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#f4f7f5] text-[var(--foreground)]">
        <AppBackground>
        <header className="app-topbar mobile-topbar sticky top-0 z-30 flex min-h-20 items-center gap-3 border-b border-[#dce8e1] px-4 md:px-8">
          <SidebarTrigger className="size-11 rounded-xl bg-white md:hidden"><Menu /></SidebarTrigger>
          {view === "inicio" ? <div className="flex flex-1 items-center gap-3"><img src="/icon-192.png" alt="" className="size-10 rounded-xl md:hidden" /><span className="font-black text-[#062b55] md:hidden">DocenteTuc</span></div> : <div className="relative max-w-2xl flex-1"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#52708c]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar en DocenteTuc" placeholder="¿Qué estás buscando?" className="h-12 rounded-2xl border-[#c8e1f1] bg-white pl-11 shadow-sm" />{query && <button aria-label="Limpiar búsqueda" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-2"><X className="size-4" /></button>}</div>}
          {installPrompt && <Button onClick={install} variant="outline" className="hidden h-11 rounded-xl border-[#bdd0c6] bg-white sm:flex"><Download className="size-4" />Instalar</Button>}
          <Button onClick={toggleTheme} size="icon" variant="outline" className="size-11 rounded-xl border-[#dce8e1] bg-white" aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}>{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}</Button>
          <Button onClick={() => setView("alertas")} size="icon" variant="outline" className="relative size-11 rounded-xl border-[#dce8e1] bg-white"><Bell className="size-5" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ee6a4b] px-1 text-[10px] font-bold text-white">{unread > 99 ? "99+" : unread}</span>}<span className="sr-only">Alertas</span></Button>
        </header>

        {offline && <div className="flex items-center justify-center gap-2 bg-[#fff3dd] px-4 py-2 text-sm font-semibold text-[#7d541b]"><WifiOff className="size-4" />Sin conexión. Podés consultar la última información cargada.</div>}

        <div className="mobile-content mx-auto w-full max-w-7xl p-4 md:p-8">
          {view === "inicio" ? <Dashboard data={data} profile={profile} savedMap={savedMap} reminderMap={reminderMap} matches={matches} matchResult={matchResult} greeting={greeting} query={query} onQuery={setQuery} syncing={syncing} onSync={() => void syncSources()} onRetry={() => void load()} onOpen={(publication) => setSelected(publication)} onRemind={setReminderPublication} onAskAI={() => openAI({ type: "inicio", title: viewTitles.inicio[0] })} onView={(target) => { setView(target); setFilter(target === "capacitaciones" ? "proximamente" : "para-mi"); }} loading={loading} error={loadError} warning={sourceWarning} /> : view === "perfil" ? <><ProfileForm profile={profile} roleOptions={roleOptions} onSaved={() => void load(false)} /><PushSettings /></> : view === "alertas" ? <Alerts data={data} onOpen={(publication) => setSelected(publication)} onRead={async (id) => { await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "read_notification", id }) }); await load(false); }} /> : view === "agenda" ? <Agenda publications={data?.publications || []} savedMap={savedMap} designations={data?.designations || []} matchResult={matchResult} onOpen={setSelected} onEditDesignation={setTrackingPublication} onAgenda={(item, enabled) => void mutateSaved("agenda", item, enabled)} /> : <>
            <PageHeader view={view} count={items.length} syncing={syncing} onSync={() => void syncSources()} onAskAI={() => openAI({ type: view, title: viewTitles[view][0] })} updatedAt={view === "capacitaciones" ? trainingSync?.synced_at : undefined} />
            <Filters filter={filter} setFilter={setFilter} level={level} setLevel={setLevel} character={character} setCharacter={setCharacter} levels={levels} kind={view} areas={trainingAreas} area={trainingArea} setArea={setTrainingArea} locations={trainingLocations} location={trainingLocation} setLocation={setTrainingLocation} date={trainingDate} setDate={setTrainingDate} />
            <PublicationList items={items} loading={loading} savedMap={savedMap} reminderMap={reminderMap} matchResult={matchResult} onOpen={setSelected} onRemind={setReminderPublication} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} />
          </>}
        </div>

        {!aiOpen && !reminderPublication && <DocenteTucAIFab onClick={() => openAI({ type: view, title: viewTitles[view][0] })} />}
        <nav className="mobile-nav fixed inset-x-3 bottom-3 z-40 flex h-[68px] rounded-2xl border border-[#dce8e1] bg-white px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_12px_40px_rgba(15,61,50,.18)] md:hidden" aria-label="Navegación móvil">
          {navigation.filter(([id]) => ["inicio", "vacantes", "capacitaciones", "agenda", "perfil"].includes(id)).map(([id, label, Icon]) => <button key={id} onClick={() => { setView(id); setFilter(id === "capacitaciones" ? "proximamente" : "para-mi"); }} aria-current={view === id ? "page" : undefined} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${view === id ? "bg-[#0878be] text-white" : "text-[#52708c]"}`}><Icon className={`size-5 ${view === id ? "stroke-[2.6]" : ""}`} /><span className="max-w-full truncate px-1">{label}</span></button>)}
        </nav>
        </AppBackground>
      </SidebarInset>

      <PublicationSheet publication={selected} saved={selected ? savedMap.get(selected.id) : undefined} tracking={selected ? designationMap.get(selected.id) : undefined} match={selected ? matchResult(selected) : null} onClose={() => setSelected(null)} onAskAI={(item) => openAI({ type: item.kind === "vacante" ? "designaciones" : item.kind, id: item.id, title: item.title })} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} onAgenda={(item, enabled) => void mutateSaved("agenda", item, enabled)} onFollow={(item, enabled) => void mutateSaved("follow", item, enabled)} onExternal={openDesignationOfficial} onEditDesignation={setTrackingPublication} />
      <ReminderDialog publication={reminderPublication} mode={reminderMode} custom={customReminder} onMode={setReminderMode} onCustom={setCustomReminder} onClose={() => setReminderPublication(null)} onSave={() => void saveReminder()} />
      <DesignationReturnDialog publication={returnPublication} onNo={() => { localStorage.removeItem("docentetuc-pending-designation"); setReturnPublication(null); }} onYes={() => { if (returnPublication) setTrackingPublication(returnPublication); localStorage.removeItem("docentetuc-pending-designation"); setReturnPublication(null); }} />
      <DesignationForm publication={trackingPublication} existing={trackingPublication ? designationMap.get(trackingPublication.id) : undefined} onClose={() => setTrackingPublication(null)} onSaved={async () => { setTrackingPublication(null); await load(false); }} />
      <DocenteTucAIChatPanel open={aiOpen} onClose={() => setAIOpen(false)} context={aiContext} profileAvailable={Boolean(profile)} headers={() => apiHeaders(true)} onAction={runAIAction} />
      <Toaster richColors position="top-center" />
    </SidebarProvider>
  );
}

type DashboardProps = { data: AppData | null; profile?: Profile; savedMap: Map<string, Saved>; reminderMap: Map<string, TrainingReminder>; matches: (item: Publication) => boolean; matchResult: (item: Publication) => MatchResult; greeting: string; query: string; onQuery: (value: string) => void; syncing: boolean; onSync: () => void; onRetry: () => void; onOpen: (item: Publication) => void; onRemind: (item: Publication) => void; onAskAI: () => void; onView: (view: View) => void; loading: boolean; error: string; warning: string };

function Dashboard({ data, profile, savedMap, reminderMap, matches, matchResult, greeting, query, onQuery, syncing, onSync, onRetry, onOpen, onRemind, onAskAI, onView, loading, error, warning }: DashboardProps) {
  const now = new Date();
  const publications = data?.publications || [];
  const publicationMap = new Map(publications.map((item) => [item.id, item]));
  const eventDate = (item: Publication) => parseTrainingMetadata(item.metadata)?.registrationOpensAt || item.ends_at || item.starts_at;
  const relevant = (item: Publication) => ["exact", "partial"].includes(matchResult(item).status);
  const agenda = publications.filter((item) => {
    const date = safeDate(eventDate(item));
    return Boolean(savedMap.get(item.id)?.in_agenda) && Boolean(date && date.getTime() >= now.getTime());
  }).sort((a, b) => safeDate(eventDate(a))!.getTime() - safeDate(eventDate(b))!.getTime());
  const todayEvents = agenda.filter((item) => calendarDayDistance(eventDate(item), now) === 0);
  const vacancies = publications.filter((item) => item.kind === "vacante" && item.status === "vigente" && relevant(item)).sort((a, b) => matchResult(b).score - matchResult(a).score);
  const forYou = publications.filter((item) => relevant(item) || Boolean(savedMap.get(item.id)?.in_agenda)).sort((a, b) => compareHomePriority({ kind: a.kind, registrationOpensAt: parseTrainingMetadata(a.metadata)?.registrationOpensAt, eventAt: eventDate(a), matched: matches(a), inAgenda: Boolean(savedMap.get(a.id)?.in_agenda), updatedAt: a.updated_at }, { kind: b.kind, registrationOpensAt: parseTrainingMetadata(b.metadata)?.registrationOpensAt, eventAt: eventDate(b), matched: matches(b), inAgenda: Boolean(savedMap.get(b.id)?.in_agenda), updatedAt: b.updated_at }, now)).slice(0, 2);
  const unread = (data?.notifications || []).filter((notice) => !Boolean(notice.read));
  const importantNotice = unread.map((notice) => ({ notice, publication: publicationMap.get(notice.publication_id) })).find(({ publication }) => publication);
  const latest = [...publications].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 3);
  const searchResults = query.trim() ? publications.filter((item) => normalize(publicationSearchText(item)).includes(normalize(query.trim()))).slice(0, 20) : [];
  const profileReady = Boolean(profile?.levels.length && (profile.areas.length || profile.subjects.length));
  const lastSync = [...(data?.sync || [])].sort((a, b) => new Date(b.synced_at).getTime() - new Date(a.synced_at).getTime())[0];
  const syncMinutes = lastSync ? Math.max(0, Math.round((now.getTime() - new Date(`${lastSync.synced_at}Z`).getTime()) / 60_000)) : null;
  const syncLabel = syncMinutes === null ? "Sin actualización" : syncMinutes < 1 ? "Actualizado recién" : `Actualizado hace ${syncMinutes} min`;
  const priorityLabel = (item: Publication) => {
    const candidate = { kind: item.kind, registrationOpensAt: parseTrainingMetadata(item.metadata)?.registrationOpensAt, eventAt: eventDate(item), matched: matches(item), inAgenda: Boolean(savedMap.get(item.id)?.in_agenda), updatedAt: item.updated_at };
    const rank = homePriority(candidate, now), days = calendarDayDistance(candidate.registrationOpensAt, now);
    return rank === 0 ? "🔥 ABRE HOY" : rank === 1 ? "🔥 ABRE MAÑANA" : rank === 2 ? `ABRE EN ${days} DÍAS` : rank === 3 ? "🎯 DESIGNACIÓN PARA VOS" : rank === 4 ? "📅 PRÓXIMO EN AGENDA" : "NOVEDAD PARA VOS";
  };

  if (error && !data) return <section className="grid min-h-[65vh] place-items-center"><div className="max-w-lg rounded-3xl border border-[#ead6b8] bg-white p-8 text-center shadow-sm"><WifiOff className="mx-auto size-10 text-[#b57828]" /><h1 className="mt-4 text-2xl font-black">No pudimos cargar tu panel</h1><p className="mt-2 text-[#61766f]">{error}. Revisá tu conexión y volvé a intentarlo.</p><Button onClick={onRetry} className="mt-6 h-11 rounded-xl bg-[#17362d] px-6 text-white"><RefreshCw className="size-4" />Reintentar</Button></div></section>;

  return <div className="daily-home">
    <header className="home-greeting"><h1 suppressHydrationWarning>{greeting}{profile?.name ? `, ${profile.name.split(" ")[0]}` : ""}</h1><p>Tu información docente, al día.</p></header>
    <div className="home-search"><div><Search className="size-4" /><Input value={query} onChange={(event) => onQuery(event.target.value)} aria-label="Buscar en DocenteTuc" placeholder="Buscar en DocenteTuc..." /></div><button type="button" onClick={onSync} disabled={syncing || loading} aria-label="Actualizar información"><RefreshCw className={`size-5 ${syncing ? "animate-spin" : ""}`} /></button><small>{syncLabel}</small></div>

    {!profileReady && !loading && <button className="home-profile-nudge" onClick={() => onView("perfil")}><span><strong>Completá tu perfil</strong><small>Recibí oportunidades más precisas.</small></span><ChevronRight className="size-5" /></button>}
    {(error || warning) && <div className="home-source-warning"><span><strong>No pudimos actualizar una fuente.</strong> Mostrando la última información disponible.</span><button onClick={onRetry}>Reintentar</button></div>}
    {importantNotice && <button className="home-alert" onClick={() => onOpen(importantNotice.publication!)}><span>⚠️</span><span><strong>IMPORTANTE</strong><small>{importantNotice.notice.title}</small></span><ChevronRight className="size-5" /></button>}

    {query.trim() && <section className="home-section"><div className="home-section-title"><div><p>BÚSQUEDA GLOBAL</p><h2>{searchResults.length} resultados</h2></div></div>{searchResults.length ? <div>{searchResults.map((item) => <div key={item.id}><span className="home-search-kind">{publicationLabel(item)}</span><CompactItem item={item} saved={savedMap.has(item.id)} onOpen={() => onOpen(item)} /></div>)}</div> : <p className="home-empty-line">No encontramos resultados en las fuentes disponibles.</p>}</section>}

    <section className="home-section home-for-you"><div className="home-section-title"><div><p>PARA VOS</p><h2>Lo más importante ahora</h2></div><button onClick={() => onView("capacitaciones")}>Ver todo <ChevronRight className="size-4" /></button></div>
      {loading ? <HomeSkeleton /> : forYou.length ? <div className="home-priority-list">{forYou.map((item) => { const result = matchResult(item), metadata = parseTrainingMetadata(item.metadata), reminded = metadata ? reminderMap.has(metadata.trainingId) : false; return <article key={item.id}><button className="home-priority-main" onClick={() => onOpen(item)}><span className="home-priority-badge">{priorityLabel(item)}</span><strong>{item.title}</strong><small>{[item.level || item.junta || item.category, item.character].filter(Boolean).join(" · ")}</small>{result.status !== "unconfigured" && <span className="home-match">{result.score}% compatible</span>}</button><div className="home-priority-actions"><button onClick={() => onOpen(item)}>Ver</button>{item.kind === "capacitacion" && metadata?.registrationOpensAt && <button onClick={() => onRemind(item)}><Bell className="size-4" />{reminded ? "Aviso activo" : "Avisarme"}</button>}</div></article>; })}</div> : <p className="home-empty-line">No hay oportunidades compatibles nuevas por ahora.</p>}
    </section>

    <section className="home-section home-today"><div className="home-section-title"><div><p>HOY</p><h2>Resumen del día</h2></div></div><div className="home-summary"><button onClick={() => onView("agenda")}><CalendarDays className="size-5" /><span><strong>{todayEvents.length}</strong> {todayEvents.length === 1 ? "evento" : "eventos"}</span><ChevronRight className="size-4" /></button><button onClick={() => onView("vacantes")}><BriefcaseBusiness className="size-5" /><span><strong>{vacancies.length}</strong> oportunidades para vos</span><ChevronRight className="size-4" /></button><button onClick={() => onView("alertas")}><Bell className="size-5" /><span><strong>{unread.length}</strong> {unread.length === 1 ? "alerta nueva" : "alertas nuevas"}</span><ChevronRight className="size-4" /></button></div></section>

    <section className="home-split"><button onClick={() => onView("agenda")}><span className="home-kicker">PRÓXIMO</span>{agenda[0] ? <><strong>{agenda[0].title}</strong><small>{dateLabel(eventDate(agenda[0]), true)}</small></> : <><strong>Agenda al día</strong><small>No tenés eventos para hoy.</small></>}<span>Ver agenda <ChevronRight className="size-4" /></span></button><button onClick={() => onView("vacantes")}><span className="home-kicker">DESIGNACIONES PARA VOS</span>{vacancies[0] ? <><strong>{vacancies[0].title}</strong><small>{vacancies.length} coincidencias · mejor {matchResult(vacancies[0]).score}%</small></> : <><strong>Sin coincidencias nuevas</strong><small>Te avisaremos cuando aparezcan.</small></>}<span>Ver designaciones <ChevronRight className="size-4" /></span></button></section>

    <section className="home-ai"><div><Sparkles className="size-5" /><strong>Preguntale a DocenteTuc IA</strong></div><div>{["¿Qué hay para mí?", "¿Qué abre pronto?", "¿Qué tengo hoy?"].map((question) => <button key={question} onClick={onAskAI}>{question}</button>)}</div></section>

    <section className="home-section home-latest"><div className="home-section-title"><div><p>ÚLTIMAS NOVEDADES</p><h2>Información reciente</h2></div><button onClick={() => onView("junta")}>Ver todas <ChevronRight className="size-4" /></button></div>{latest.length ? <div>{latest.map((item) => <CompactItem key={item.id} item={item} saved={savedMap.has(item.id)} onOpen={() => onOpen(item)} />)}</div> : <p className="home-empty-line">No hay novedades publicadas.</p>}</section>
  </div>;
}

function HomeSkeleton() { return <div className="home-skeleton" aria-label="Cargando oportunidades"><span /><span /><span /></div>; }

function ReminderDialog({ publication, mode, custom, onMode, onCustom, onClose, onSave }: { publication: Publication | null; mode: string; custom: string; onMode: (value: string) => void; onCustom: (value: string) => void; onClose: () => void; onSave: () => void }) {
  const metadata = publication ? parseTrainingMetadata(publication.metadata) : null;
  return <Dialog open={Boolean(publication)} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-[#062b55]"><Bell className="size-5 text-[#0878be]" />Avisarme cuando abra</DialogTitle><DialogDescription>{publication?.title}</DialogDescription></DialogHeader>{metadata?.registrationOpensAt && <div className="rounded-2xl bg-[#edf6fc] p-4 text-sm text-[#335f7d]"><strong className="block">Apertura oficial: {dateLabel(metadata.registrationOpensAt, Boolean(metadata.registrationHasTime))}</strong>{!metadata.registrationHasTime && <span>El sitio oficial informa la fecha pero no el horario exacto.</span>}</div>}<div className="space-y-2"><Label>¿Cuándo querés recibir el aviso?</Label><Select value={mode} onValueChange={(value) => onMode(value || "one_day")}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="at_open">Cuando abra</SelectItem>{metadata?.registrationHasTime && <SelectItem value="one_hour">1 hora antes</SelectItem>}<SelectItem value="one_day">1 día antes</SelectItem><SelectItem value="custom">Personalizado</SelectItem></SelectContent></Select>{mode === "custom" && <Input type="datetime-local" value={custom} onChange={(event) => onCustom(event.target.value)} className="h-11 rounded-xl" />}</div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={onSave} disabled={mode === "custom" && !custom} className="bg-[#0878be] text-white"><Bell className="size-4" />Activar recordatorio</Button></DialogFooter></DialogContent></Dialog>;
}

function DesignationReturnDialog({ publication, onNo, onYes }: { publication: Publication | null; onNo: () => void; onYes: () => void }) {
  return <Dialog open={Boolean(publication)} onOpenChange={(open) => !open && onNo()}><DialogContent><DialogHeader><DialogTitle>¿Pudiste inscribirte?</DialogTitle><DialogDescription>{publication?.title}<br />Abrir SIME no cambia el estado automáticamente.</DialogDescription></DialogHeader><DialogFooter><Button variant="outline" onClick={onNo}>No todavía</Button><Button onClick={onYes} className="bg-[#0878be] text-white">✓ Sí, me inscribí</Button></DialogFooter></DialogContent></Dialog>;
}

const dateTimeInput = (value?: string | null) => { if (!value) return ""; const date = new Date(value); return Number.isNaN(date.getTime()) ? "" : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
function DesignationForm({ publication, existing, onClose, onSaved }: { publication: Publication | null; existing?: DesignationTracking; onClose: () => void; onSaved: () => void }) {
  if (!publication) return null;
  return <DesignationFormContent key={`${publication.id}:${existing?.updated_at || "new"}`} publication={publication} existing={existing} onClose={onClose} onSaved={onSaved} />;
}

function DesignationFormContent({ publication, existing, onClose, onSaved }: { publication: Publication; existing?: DesignationTracking; onClose: () => void; onSaved: () => void }) {
  const facts = designationFacts(publication), [busy, setBusy] = useState(false), [reminderMode, setReminderMode] = useState(existing?.reminder_at ? "custom" : "none");
  const [form, setForm] = useState({ status: existing?.status || "INSCRIPTO", role: existing?.role || facts.role, subject: existing?.subject || publication.area, school: existing?.school || facts.school, address: existing?.address || "", locality: existing?.locality || facts.locality, appliedAt: dateTimeInput(existing?.applied_at || new Date().toISOString()), appointmentAt: dateTimeInput(existing?.appointment_at), shift: existing?.shift || facts.shift, board: existing?.board || facts.board, documentation: existing?.documentation || "", orderNumber: existing?.order_number || "", notes: existing?.notes || "", reminderAt: dateTimeInput(existing?.reminder_at) });
  const field = (key: keyof typeof form, label: string, type = "text") => <label className="space-y-1 text-sm font-semibold text-[var(--text-secondary)]">{label}<Input type={type} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} className="h-11 bg-white" /></label>;
  const save = async () => {
    setBusy(true);
    try {
      const appointment = form.appointmentAt ? new Date(form.appointmentAt) : null;
      const reminderAt = reminderMode === "custom" ? form.reminderAt : appointment && reminderMode !== "none" ? new Date(appointment.getTime() - (reminderMode === "one_day" ? 86_400_000 : 7_200_000)).toISOString() : null;
      const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "save_designation", publicationId: publication.id, ...form, reminderAt }) }), result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "No se pudo guardar");
      toast.success("Seguimiento de designación guardado"); onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo guardar"); } finally { setBusy(false); }
  };
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl"><DialogHeader><DialogTitle>Registrar designación</DialogTitle><DialogDescription>Completá solamente los datos que te sirvan. Podés modificarlos después.</DialogDescription></DialogHeader><div className="grid gap-4 sm:grid-cols-2"><label className="space-y-1 text-sm font-semibold text-[var(--text-secondary)]">Estado<Select value={form.status} onValueChange={(status) => setForm({ ...form, status: status || "INSCRIPTO" })}><SelectTrigger className="h-11 bg-white"><SelectValue /></SelectTrigger><SelectContent>{DESIGNATION_STATUSES.map((status) => <SelectItem key={status} value={status}>{status}</SelectItem>)}</SelectContent></Select></label>{field("role", "Cargo")}{field("subject", "Materia / área")}{field("school", "Establecimiento")}{field("address", "Dirección")}{field("locality", "Localidad")}{field("appliedAt", "Inscripción realizada", "datetime-local")}{field("appointmentAt", "Fecha de designación", "datetime-local")}{field("shift", "Turno")}{field("board", "Junta")}{field("documentation", "Documentación requerida")}{field("orderNumber", "Número / orden / posición")}<label className="space-y-1 text-sm font-semibold text-[var(--text-secondary)] sm:col-span-2">Observaciones<Textarea value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className="min-h-24 bg-white" /></label><label className="space-y-1 text-sm font-semibold text-[var(--text-secondary)] sm:col-span-2">Recordarme<Select value={reminderMode} onValueChange={(value) => setReminderMode(value || "none")}><SelectTrigger className="h-11 bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin recordatorio</SelectItem>{form.appointmentAt && <><SelectItem value="one_day">1 día antes</SelectItem><SelectItem value="two_hours">2 horas antes</SelectItem></>}<SelectItem value="custom">Hora personalizada</SelectItem></SelectContent></Select>{reminderMode === "custom" && <Input type="datetime-local" value={form.reminderAt} onChange={(event) => setForm({ ...form, reminderAt: event.target.value })} className="mt-2 h-11 bg-white" />}</label></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} disabled={busy || (reminderMode === "custom" && !form.reminderAt)} className="bg-[#0878be] text-white">Guardar seguimiento</Button></DialogFooter></DialogContent></Dialog>;
}

function PageHeader({ view, count, syncing = false, onSync, onAskAI, updatedAt }: { view: View; count: number; syncing?: boolean; onSync?: () => void; onAskAI?: () => void; updatedAt?: string }) { const [title, subtitle] = viewTitles[view]; return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><p className="mb-1 text-xs font-bold uppercase tracking-[.16em] text-[var(--accent-text)]">DocenteTuc</p><h1 className="text-3xl font-black tracking-tight text-[var(--text-primary)]">{title}</h1><p className="mt-1 text-[var(--text-muted)]">{subtitle} · {count} resultados</p>{updatedAt && <p className="mt-1 text-xs font-semibold text-[var(--text-muted)]">Actualizado: {dateLabel(`${updatedAt}Z`, true)}</p>}</div><div className="flex gap-2">{onAskAI && <Button onClick={onAskAI} className="rounded-xl bg-[#0878be] text-[var(--text-on-accent)]"><Sparkles className="size-4" />Preguntar a IA</Button>}{onSync && <Button onClick={onSync} disabled={syncing} variant="outline" className="rounded-xl border-[var(--info-border)] bg-[var(--surface-primary)] text-[var(--info-text)] hover:bg-[var(--info-bg)] hover:text-[var(--info-text)] active:bg-[var(--accent-soft)] disabled:border-[var(--border)] disabled:bg-[var(--surface-secondary)] disabled:text-[var(--text-muted)]"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />Actualizar</Button>}</div></div>; }

function Filters({ filter, setFilter, level, setLevel, character, setCharacter, levels, kind, areas, area, setArea, locations, location, setLocation, date, setDate }: { filter: string; setFilter: (value: string) => void; level: string; setLevel: (value: string) => void; character: string; setCharacter: (value: string) => void; levels: string[]; kind: View; areas: string[]; area: string; setArea: (value: string) => void; locations: string[]; location: string; setLocation: (value: string) => void; date: string; setDate: (value: string) => void }) {
  const tabs = kind === "capacitaciones" ? [["proximamente", "Próximas"], ["hoy", "🔥 Abren hoy"], ["abiertas", "Abiertas"], ["todas", "Todas"]] : kind === "junta" ? [["para-mi", "Para mí"], ["todas", "Todo"], ["llamados", "Llamados abiertos"], ["padrones", "Padrones"], ["comunicados", "Comunicados"], ["nuevas", "Novedades"]] : [["para-mi", "Para mí"], ["todas", "Todas"], ["nuevas", "Nuevas"], ["guardadas", "Guardadas"], ["por-vencer", "Por vencer"]];
  return <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-[#c8e1f1] bg-white p-3 shadow-sm"><SlidersHorizontal className="mx-2 mt-2 size-4 text-[#2b9fdc]" />{tabs.map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className={`min-h-9 rounded-xl px-3 text-sm font-semibold ${filter === id ? "bg-[#0878be] text-white" : "bg-[#edf6fc] text-[#52708c]"}`}>{label}</button>)}
    {!["junta", "guardados"].includes(kind) && <Select value={level} onValueChange={(value) => setLevel(value || "todos")}><SelectTrigger className="ml-auto h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Nivel" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos los niveles</SelectItem>{levels.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>}
    {["vacantes", "capacitaciones"].includes(kind) && <Select value={character} onValueChange={(value) => setCharacter(value || "todos")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Carácter" /></SelectTrigger><SelectContent><SelectItem value="todos">Todo carácter/modalidad</SelectItem>{kind === "vacantes" ? <><SelectItem value="interino">Interino</SelectItem><SelectItem value="suplente">Suplente</SelectItem></> : <><SelectItem value="virtual">Virtual</SelectItem><SelectItem value="presencial">Presencial</SelectItem><SelectItem value="semipresencial">Semipresencial</SelectItem></>}</SelectContent></Select>}
    {kind === "capacitaciones" && <><Select value={area} onValueChange={(value) => setArea(value || "todas")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Área" /></SelectTrigger><SelectContent><SelectItem value="todas">Todas las áreas</SelectItem>{areas.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={location} onValueChange={(value) => setLocation(value || "todos")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Lugar" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos los lugares</SelectItem>{locations.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Filtrar por fecha" className="h-9 w-auto rounded-xl border-[#dce8e1]" /></>}
  </div>;
}

function PublicationList({ items, loading, savedMap, reminderMap, matchResult, onOpen, onSave, onRemind }: { items: Publication[]; loading: boolean; savedMap: Map<string, Saved>; reminderMap: Map<string, TrainingReminder>; matchResult: (item: Publication) => MatchResult; onOpen: (item: Publication) => void; onSave: (item: Publication, enabled: boolean) => void; onRemind: (item: Publication) => void }) {
  if (loading) return <LoadingCards />; if (!items.length) return <Empty title="No encontramos resultados" text="Probá con otra búsqueda o cambiá los filtros." />;
  return <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => {
    const saved = savedMap.has(item.id), compatibility = matchResult(item), training = item.kind === "capacitacion", metadata = training ? parseTrainingMetadata(item.metadata) : null, reminded = metadata ? reminderMap.has(metadata.trainingId) : false;
    const statusClass = item.status === "vigente" || item.status === "inscripción abierta" ? "border-[#b9d9c4] bg-[#edf8f0] text-[#34724b]" : item.status === "próximamente" ? "border-[#f0d58b] bg-[#fff7dd] text-[#8b6500]" : "border-[#dfd8c9] text-[#7e7462]";
    return <article key={item.id} className={`flex flex-col rounded-3xl border border-[#dce8e1] bg-white p-5 shadow-[0_8px_30px_rgba(20,64,52,.04)] ${item.kind === "vacante" ? "min-h-[190px]" : "min-h-[230px]"}`}>
      <div className="mb-3 flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><Badge variant="secondary" className="bg-[#edf4ef] text-[#356053]">{publicationLabel(item)}</Badge><Badge variant="outline" className={statusClass}>{item.status === "inscripción abierta" ? "🟢 Inscripción abierta" : item.status}</Badge><MatchBadge result={compatibility} /></div>{!training && <button onClick={() => onSave(item, !saved)} aria-label={saved ? "Quitar de guardados" : "Guardar publicación"} className={`grid size-10 shrink-0 place-items-center rounded-xl ${saved ? "bg-[#fff3dd] text-[#a46c20]" : "bg-[#f1f5f2] text-[#6d837a]"}`}><Star className={`size-5 ${saved ? "fill-current" : ""}`} /></button>}</div>
      {metadata?.registrationOpensAt && item.status === "próximamente" && <div className="mb-4 rounded-2xl bg-[#fff4d6] p-4 text-[#6f4c00]"><strong className="block text-lg">{openingCountdown(metadata.registrationOpensAt, new Date(), metadata.registrationHasTime)}</strong><span className="text-sm">Abre: {dateLabel(metadata.registrationOpensAt, false)}</span></div>}
      <button onClick={() => onOpen(item)} className="text-left"><h2 className="line-clamp-2 text-lg font-bold leading-snug hover:underline">{item.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#657b73]">{item.summary || `Información publicada por ${item.source}.`}</p></button>
      {training ? <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-[#61766f]">{item.character && <span><strong>Modalidad:</strong> {item.character}</span>}{item.starts_at && <span><strong>Inicio:</strong> {dateLabel(item.starts_at)}</span>}{metadata?.registrationClosesAt && <span><strong>Inscripción hasta:</strong> {dateLabel(metadata.registrationClosesAt, true)}</span>}{item.location && <span className="col-span-2"><strong>Lugar:</strong> {item.location}</span>}</div> : <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#61766f]">{item.character && <span>{item.character}</span>}{item.junta && <span>{item.junta}</span>}{item.shift && <span>Turno {item.shift}</span>}{item.ends_at && <span className="ml-auto flex items-center gap-1 font-semibold text-[#9a641f]"><Clock3 className="size-4" />{fromNow(item.ends_at)}</span>}</div>}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[#e7eee9] pt-3">
        {training && metadata?.registrationOpensAt && <button onClick={() => onRemind(item)} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#fff4d6] px-3 text-sm font-bold text-[#7b5500]"><Bell className="size-4" />{reminded ? "Aviso activo" : "Recordarme"}</button>}
        {training && <button onClick={() => onSave(item, !saved)} className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold ${saved ? "bg-[#fff3dd] text-[#8b5b00]" : "bg-[#edf6fc] text-[#0878be]"}`}><Star className={`size-4 ${saved ? "fill-current" : ""}`} />{saved ? "Guardada" : "Guardar"}</button>}
        <button onClick={() => onOpen(item)} className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#1f5f4e] hover:bg-[#edf4ef]">Ver <ChevronRight className="size-4" /></button>
        {training && item.status === "inscripción abierta" && metadata?.commissionId && <a href={item.official_url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-xl bg-[#0878be] px-4 text-sm font-black text-white">INSCRIBIRME <ExternalLink className="size-4" /></a>}
      </div>
    </article>;
  })}</div>;
}

function MatchBadge({ result }: { result: MatchResult }) {
  if (result.status === "unconfigured") return null;
  if (result.criteria.length > 0 && result.criteria.every((criterion) => !criterion.available)) return <Badge className="badge-neutral">Información insuficiente</Badge>;
  const labels = { exact: "Coincidencia exacta", partial: "Coincidencia parcial", none: "No coincide" } as const;
  const color = result.status === "exact" ? "badge-success" : result.status === "partial" ? "badge-warning" : "badge-neutral";
  return <Badge className={color}>{labels[result.status]} · {result.score}%</Badge>;
}

function CompactItem({ item, saved, onOpen }: { item: Publication; saved: boolean; onOpen: () => void }) { return <button onClick={onOpen} className="flex w-full items-center gap-4 py-4 text-left"><span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${item.kind === "vacante" ? "bg-[#e2f4ff] text-[#0878be]" : item.kind === "capacitacion" ? "bg-[#dff7ff] text-[#0878be]" : "bg-[#e8efff] text-[#1b4e96]"}`}>{item.kind === "vacante" ? <BriefcaseBusiness className="size-5" /> : item.kind === "capacitacion" ? <GraduationCap className="size-5" /> : <BookOpen className="size-5" />}</span><span className="min-w-0 flex-1"><span className="line-clamp-1 font-bold text-[#062b55]">{item.title}</span><span className="mt-1 block text-sm text-[#52708c]">{item.ends_at ? fromNow(item.ends_at) : item.category} · {item.source}</span></span>{saved && <Star className="size-4 fill-[#f4b942] text-[#c88608]" />}<ChevronRight className="size-5 text-[#8aa9bf]" /></button>; }

function Agenda({ publications, savedMap, designations, matchResult, onOpen, onEditDesignation, onAgenda }: { publications: Publication[]; savedMap: Map<string, Saved>; designations: DesignationTracking[]; matchResult: (item: Publication) => MatchResult; onOpen: (item: Publication) => void; onEditDesignation: (item: Publication) => void; onAgenda: (item: Publication, enabled: boolean) => void }) {
  const [mode, setMode] = useState<"today" | "week" | "designations">("today"), now = new Date(), publicationMap = new Map(publications.map((item) => [item.id, item]));
  const eventDate = (item: Publication) => parseTrainingMetadata(item.metadata)?.registrationOpensAt || item.ends_at || item.starts_at;
  const personal = publications.filter((item) => Boolean(savedMap.get(item.id)?.in_agenda) && safeDate(eventDate(item))).sort((a, b) => safeDate(eventDate(a))!.getTime() - safeDate(eventDate(b))!.getTime());
  const events = personal.filter((item) => { const distance = calendarDayDistance(eventDate(item), now); return distance !== null && (mode === "today" ? distance === 0 : distance >= 0 && distance <= 7); });
  const row = (item: Publication) => { const date = safeDate(eventDate(item))!, result = matchResult(item); return <article key={item.id} className="agenda-event rounded-2xl border border-[var(--border)] bg-white p-4"><div className="flex gap-4"><span className="grid h-14 w-16 shrink-0 place-items-center rounded-2xl bg-[#fff3dd] text-center text-[#6f4c00]"><span><strong className="block text-lg leading-none">{date.getDate()}</strong><small className="uppercase">{new Intl.DateTimeFormat("es-AR", { month: "short" }).format(date)}</small></span></span><button onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left"><span className="line-clamp-2 font-bold text-[var(--text-primary)]">{item.title}</span><span className="mt-1 block text-sm text-[var(--text-muted)]">{item.category} · {dateLabel(date.toISOString(), true)}</span>{result.status !== "unconfigured" && <span className="mt-2 inline-flex rounded-full bg-[var(--accent-soft)] px-2.5 py-1 text-xs font-black text-[var(--accent-text)]">{result.score}% compatible</span>}</button></div><div className="mt-3 flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => onOpen(item)} className="rounded-xl">Ver detalle</Button><Button type="button" onClick={() => onAgenda(item, false)} className="rounded-xl bg-[#0878be] text-white">Quitar</Button></div></article>; };
  return <><PageHeader view="agenda" count={mode === "designations" ? designations.length : events.length} syncing={false} onSync={() => undefined} /><div className="mb-5 grid grid-cols-3 gap-1 rounded-2xl bg-[var(--surface-secondary)] p-1">{([['today','Hoy'],['week','Semana'],['designations','Designaciones']] as const).map(([id,label]) => <button key={id} onClick={() => setMode(id)} className={`min-h-11 rounded-xl px-2 text-sm font-bold ${mode === id ? "bg-[#0878be] text-white" : "text-[var(--text-secondary)]"}`}>{label}</button>)}</div>{mode === "designations" ? <section className="rounded-3xl border border-[var(--border)] bg-white p-4 md:p-7"><h2 className="text-xl font-black">Mis designaciones</h2><p className="mb-4 text-sm text-[var(--text-muted)]">Inscripciones activas e historial. El resultado siempre lo actualizás vos.</p>{designations.length ? <div className="grid gap-3">{designations.map((tracking) => { const item = publicationMap.get(tracking.publication_id), date = tracking.appointment_at || tracking.applied_at || tracking.updated_at; return <article key={tracking.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4"><div className="flex items-start gap-3"><span className="rounded-xl bg-[var(--accent-soft)] px-3 py-2 text-center text-xs font-black text-[var(--accent-text)]">{dateLabel(date).toUpperCase()}</span><button onClick={() => item && onOpen(item)} className="min-w-0 flex-1 text-left"><strong className="block text-[var(--text-primary)]">{tracking.role || item?.title || "Designación"}</strong><small className="mt-1 block text-[var(--text-muted)]">{tracking.school || item?.title}</small><Badge className="badge-info mt-2">{tracking.status}</Badge></button>{item && <Button type="button" variant="outline" onClick={() => onEditDesignation(item)} className="rounded-xl">Editar</Button>}</div>{tracking.notes && <p className="mt-3 text-sm text-[var(--text-muted)]">{tracking.notes}</p>}</article>; })}</div> : <Empty title="Todavía no registraste designaciones" text="Después de inscribirte en el sitio oficial, confirmá el registro para iniciar el seguimiento." />}</section> : <section className="rounded-3xl border border-[var(--border)] bg-white p-4 md:p-7"><h2 className="text-xl font-black">{mode === "today" ? "Hoy" : "Próximos 7 días"}</h2><p className="mb-4 text-sm text-[var(--text-muted)]">Eventos que agregaste personalmente.</p>{events.length ? <div className="grid gap-3 lg:grid-cols-2">{events.map(row)}</div> : <Empty title={mode === "today" ? "No tenés eventos para hoy" : "No tenés eventos esta semana"} text="Podés agregar fechas desde cualquier publicación." />}</section>}</>;
}

function Alerts({ data, onOpen, onRead }: { data: AppData | null; onOpen: (item: Publication) => void; onRead: (id: number) => void }) { const publicationMap = new Map((data?.publications || []).map((item) => [item.id, item])); return <><PageHeader view="alertas" count={data?.notifications.length || 0} syncing={false} onSync={() => undefined} /><div className="rounded-3xl border border-[#dce8e1] bg-white p-4 md:p-6">{data?.notifications.length ? <div className="divide-y divide-[#e7eee9]">{data.notifications.map((notice) => <button key={notice.id} onClick={() => { const item = publicationMap.get(notice.publication_id); if (item) onOpen(item); if (!Boolean(notice.read)) void onRead(notice.id); }} className="flex w-full gap-4 py-4 text-left"><span className={`mt-1 size-2 shrink-0 rounded-full ${Boolean(notice.read) ? "bg-[#c7d2cd]" : "bg-[#ee6a4b]"}`} /><span className="flex-1"><span className="block font-bold">{notice.title}</span><span className="mt-1 block text-sm text-[#6c847b]">{notice.type.replaceAll("_", " ")} · {dateLabel(`${notice.created_at}Z`, true)}</span></span><ChevronRight className="size-5 text-[#9bada6]" /></button>)}</div> : <Empty title="No hay alertas nuevas" text="Las alertas aparecen cuando una publicación coincide con tu perfil o cambia un documento seguido." />}</div></>; }

function MultiValueField({ label, values, placeholder, suggestions = [], onChange }: { label: string; values: string[]; placeholder: string; suggestions?: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const next = draft.trim(); if (!next || values.some((item) => normalize(item) === normalize(next))) return; onChange([...values, next]); setDraft(""); };
  const available = suggestions.filter((item) => !values.some((value) => normalize(value) === normalize(item)) && (!draft || normalize(item).includes(normalize(draft)))).slice(0, 6);
  return <div className="space-y-2"><Label>{label}</Label><div className="rounded-2xl border border-[var(--border)] bg-[var(--input-background)] p-3"><div className="mb-2 flex flex-wrap gap-2">{values.map((item) => <button type="button" key={item} onClick={() => onChange(values.filter((value) => value !== item))} className="min-h-10 rounded-full bg-[var(--accent-soft)] px-3 text-sm font-bold text-[var(--accent-text)]" aria-label={`Quitar ${item}`}>✓ {item} ×</button>)}</div><div className="flex gap-2"><Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} placeholder={placeholder} className="h-11 rounded-xl bg-white" /><Button type="button" variant="outline" onClick={add} className="h-11 rounded-xl">Agregar</Button></div>{available.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{available.map((item) => <button type="button" key={item} onClick={() => onChange([...values, item])} className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">+ {item}</button>)}</div>}</div></div>;
}

function ProfileForm({ profile, roleOptions, onSaved }: { profile?: Profile; roleOptions: string[]; onSaved: () => void }) {
  const [form, setForm] = useState(profile || null); useEffect(() => setForm(profile || null), [profile]);
  if (!form) return <LoadingCards />;
  const field = (key: "name" | "department" | "locality", label: string, placeholder: string) => <div className="space-y-2"><Label htmlFor={key}>{label}</Label><Input id={key} value={form[key]} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={placeholder} className="h-11 rounded-xl border-[var(--border)] bg-white" /></div>;
  const hasLevel = (level: string) => form.levels.some((item) => normalize(item) === normalize(level));
  const toggleLevel = (level: string) => setForm({ ...form, levels: hasLevel(level) ? form.levels.filter((item) => normalize(item) !== normalize(level)) : [...form.levels, level] });
  const save = async () => { const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "save_profile", name: form.name, levels: form.levels, areas: form.areas, subjects: form.subjects, boards: form.boards, roles: form.roles, department: form.department, locality: form.locality, shifts: form.shifts, wantsInterim: Boolean(form.wants_interim), wantsSubstitute: Boolean(form.wants_substitute), trainingInterests: form.training_interests, notifyNewTrainings: Boolean(form.notify_new_trainings), trainingNotifyScope: form.training_notify_scope }) }); if (response.ok) { toast.success("Perfil actualizado"); onSaved(); } else toast.error("No se pudo actualizar el perfil"); };
  return <><PageHeader view="perfil" count={0} syncing={false} onSync={() => undefined} /><section className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface-secondary)] p-5 md:p-6"><h2 className="text-lg font-bold">Ya tengo cuenta oficial</h2><p className="mt-1 text-sm text-[var(--text-muted)]">Ingresá con tu cuenta existente directamente en el sistema correspondiente. DocenteTuc nunca recibe tu contraseña.</p><div className="mt-4 flex flex-wrap gap-3"><a href={FDCI_LOGIN} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl bg-[#0878be] px-4 font-bold text-white">Ingresar a FDCI <ExternalLink className="size-4" /></a><a href={SIME_LOGIN} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-4 font-bold text-[var(--text-primary)]">Ingresar a SIME <ExternalLink className="size-4" /></a></div></section><form onSubmit={(event) => { event.preventDefault(); void save(); }} className="grid gap-5 rounded-3xl border border-[var(--border)] bg-white p-5 md:grid-cols-2 md:p-8">{field("name", "Nombre", "Tu nombre")}<fieldset className="space-y-2"><legend className="font-medium">Niveles en los que trabajo / puedo trabajar</legend><div className="flex flex-wrap gap-2">{EDUCATION_LEVELS.map((level) => <button type="button" key={level} aria-pressed={hasLevel(level)} onClick={() => toggleLevel(level)} className={`min-h-11 rounded-full border px-4 font-bold ${hasLevel(level) ? "border-[#0878be] bg-[#0878be] text-white" : "border-[var(--border)] bg-[var(--input-background)] text-[var(--text-secondary)]"}`}>{hasLevel(level) ? "✓ " : ""}{level}</button>)}</div></fieldset><MultiValueField label="Áreas" values={form.areas} placeholder="Ej. Ciencias Sociales" onChange={(areas) => setForm({ ...form, areas })} /><MultiValueField label="Materias o espacios" values={form.subjects} placeholder="Ej. Psicología" onChange={(subjects) => setForm({ ...form, subjects })} /><MultiValueField label="Cargos / roles que me interesan" values={form.roles} suggestions={roleOptions} placeholder="Buscá entre cargos publicados por SIME" onChange={(roles) => setForm({ ...form, roles })} /><MultiValueField label="Juntas" values={form.boards} placeholder="Ej. Secundaria" onChange={(boards) => setForm({ ...form, boards })} />{field("department", "Departamento / zona", "Ej. Capital")}{field("locality", "Localidad", "Ej. San Miguel de Tucumán")}<MultiValueField label="Turnos de interés" values={form.shifts} placeholder="Ej. Mañana" onChange={(shifts) => setForm({ ...form, shifts })} /><MultiValueField label="Capacitaciones de interés" values={form.training_interests} placeholder="Ej. Educación digital" onChange={(training_interests) => setForm({ ...form, training_interests })} /><div className="flex flex-col justify-center gap-4 rounded-2xl bg-[var(--surface-secondary)] p-4"><label className="flex items-center justify-between gap-4"><span><strong className="block">Interinatos</strong><small className="text-[var(--text-muted)]">Incluir en coincidencias</small></span><Switch checked={Boolean(form.wants_interim)} onCheckedChange={(checked) => setForm({ ...form, wants_interim: checked })} /></label><label className="flex items-center justify-between gap-4"><span><strong className="block">Suplencias</strong><small className="text-[var(--text-muted)]">Incluir en coincidencias</small></span><Switch checked={Boolean(form.wants_substitute)} onCheckedChange={(checked) => setForm({ ...form, wants_substitute: checked })} /></label></div><div className="rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4"><label className="flex items-center justify-between gap-4"><span><strong className="block">Nuevas capacitaciones</strong><small className="text-[var(--text-muted)]">Recibir alertas según tu selección</small></span><Switch checked={Boolean(form.notify_new_trainings)} onCheckedChange={(checked) => setForm({ ...form, notify_new_trainings: checked })} /></label><Select value={form.training_notify_scope || "relevant"} onValueChange={(value) => setForm({ ...form, training_notify_scope: (value || "relevant") as Profile["training_notify_scope"] })}><SelectTrigger className="mt-3 h-10 rounded-xl bg-white"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Todas</SelectItem><SelectItem value="level">Según mis niveles</SelectItem><SelectItem value="area">Según mis materias/áreas</SelectItem><SelectItem value="interests">Según mis intereses</SelectItem><SelectItem value="relevant">Sólo coincidencias relevantes</SelectItem></SelectContent></Select></div><div className="flex flex-wrap items-center justify-between gap-4 border-t border-[var(--border)] pt-5 md:col-span-2"><p className="max-w-xl text-sm text-[var(--text-muted)]">Las coincidencias no certifican habilitación legal. Nunca solicitamos tu contraseña de SIME ni de FDCI.</p><Button type="submit" className="h-11 rounded-xl bg-[#0878be] px-6 text-white">Guardar preferencias</Button></div></form></>;
}

type PushPreferenceState = { enabled: boolean; vacancies: boolean; designationExact: boolean; designationPartial: boolean; designationRoles: boolean; trainings: boolean; commissions: boolean; reminders: boolean; dateChanges: boolean; closingSoon: boolean; boards: boolean; quietStart: string; quietEnd: string };
const defaultPushPreferences: PushPreferenceState = { enabled: true, vacancies: true, designationExact: true, designationPartial: true, designationRoles: true, trainings: true, commissions: true, reminders: true, dateChanges: true, closingSoon: true, boards: false, quietStart: "22:00", quietEnd: "07:00" };
const decodeVapidKey = (value: string) => { const padded = value + "=".repeat((4 - value.length % 4) % 4), binary = atob(padded.replace(/-/g, "+").replace(/_/g, "/")), bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index); return bytes; };
const pushActivationMessage = (error: unknown) => {
  const message = error instanceof Error ? error.message : "";
  if (/registration failed|push service error/i.test(message)) return "El servicio push del navegador está desactivado o no responde. En Brave activá ‘Usar servicios de Google para mensajería push’; también podés probar Chrome o Samsung Internet.";
  if (error instanceof DOMException && error.name === "NotAllowedError") return "El navegador bloqueó las notificaciones. Permitilas en la configuración del sitio y volvé a intentarlo.";
  if (error instanceof DOMException && error.name === "AbortError") return "El navegador no pudo conectarse con su servicio de notificaciones. Verificá la conexión y los servicios de Google del teléfono.";
  return message || "No se pudieron activar las alertas";
};

function PushSettings() {
  const [available, setAvailable] = useState(true), [subscribed, setSubscribed] = useState(false), [permission, setPermission] = useState<NotificationPermission>("default"), [busy, setBusy] = useState(false), [preferences, setPreferences] = useState(defaultPushPreferences);
  const supported = typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  useEffect(() => {
    if (!supported) return;
    void fetch("/api/push", { headers: apiHeaders() }).then(async (response) => ({ response, result: await response.json() as { supported?: boolean; subscribed?: boolean; preferences?: Record<string, unknown> } })).then(({ response, result }) => {
      if (!response.ok) return;
      setPermission(Notification.permission); setAvailable(Boolean(result.supported)); setSubscribed(Boolean(result.subscribed));
      if (result.preferences) setPreferences({
        enabled: Boolean(result.preferences.enabled), vacancies: Boolean(result.preferences.vacancies), designationExact: result.preferences.designation_exact !== false && result.preferences.designation_exact !== 0, designationPartial: result.preferences.designation_partial !== false && result.preferences.designation_partial !== 0, designationRoles: result.preferences.designation_roles !== false && result.preferences.designation_roles !== 0, trainings: Boolean(result.preferences.trainings), commissions: Boolean(result.preferences.commissions), reminders: Boolean(result.preferences.reminders),
        dateChanges: Boolean(result.preferences.date_changes), closingSoon: Boolean(result.preferences.closing_soon), boards: Boolean(result.preferences.boards), quietStart: String(result.preferences.quiet_start || "22:00"), quietEnd: String(result.preferences.quiet_end || "07:00"),
      });
    }).catch(() => setAvailable(false));
  }, [supported]);
  const request = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/push", { method: "POST", headers: apiHeaders(true), body: JSON.stringify(body) }), result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "No se pudo actualizar la configuración.");
  };
  const activate = async () => {
    setBusy(true);
    try {
      const permissionResult = await Notification.requestPermission(); setPermission(permissionResult);
      if (permissionResult !== "granted") throw new Error(permissionResult === "denied" ? "Los avisos quedaron bloqueados. Habilitalos desde la configuración del navegador." : "No se concedió permiso para mostrar alertas.");
      const configResponse = await fetch("/api/push", { headers: apiHeaders() }), config = await configResponse.json() as { vapidPublicKey?: string; error?: string };
      if (!configResponse.ok || !config.vapidPublicKey) throw new Error(config.error || "El servidor push todavía no está configurado.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription() || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decodeVapidKey(config.vapidPublicKey) });
      await request({ action: "subscribe", subscription: subscription.toJSON() });
      setSubscribed(true); toast.success("Alertas activadas en este dispositivo");
    } catch (error) { toast.error(pushActivationMessage(error), { duration: 9000 }); }
    finally { setBusy(false); }
  };
  const deactivate = async () => {
    setBusy(true);
    try { const registration = await navigator.serviceWorker.ready, subscription = await registration.pushManager.getSubscription(); if (subscription) { await request({ action: "unsubscribe", endpoint: subscription.endpoint }); await subscription.unsubscribe(); } setSubscribed(false); toast.success("Alertas desactivadas en este dispositivo"); }
    catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron desactivar las alertas"); }
    finally { setBusy(false); }
  };
  const save = async () => { setBusy(true); try { await request({ action: "preferences", ...preferences }); toast.success("Preferencias de alertas guardadas"); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudieron guardar las preferencias"); } finally { setBusy(false); } };
  const test = async () => { setBusy(true); try { await request({ action: "test" }); toast.success("Prueba enviada. Cerrá DocenteTuc y revisá la notificación."); } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo enviar la prueba"); } finally { setBusy(false); } };
  const blocked = !supported || !available || permission === "denied", active = permission === "granted" && subscribed;
  const status = active ? "Activadas" : blocked ? "Bloqueadas" : "Pendientes";
  const toggle = (key: keyof PushPreferenceState, label: string) => <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-white p-3"><span className="text-sm font-semibold">{label}</span><Switch checked={Boolean(preferences[key])} onCheckedChange={(checked) => setPreferences({ ...preferences, [key]: checked })} disabled={!active || busy} /></label>;
  return <section className="push-settings mt-5 rounded-3xl border p-5 md:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><p className="text-xs font-black uppercase tracking-[.16em] text-[var(--accent-text)]">Alertas en tu celular</p><h2 className="mt-2 text-xl font-black text-[var(--text-primary)]">Recibí novedades aunque DocenteTuc esté cerrada</h2><p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">Al activar, el navegador pedirá permiso una sola vez. Guardamos una suscripción técnica de este dispositivo, nunca contraseñas de SIME o FDCI. Podés desactivarla cuando quieras.</p></div><Badge className={active ? "badge-success" : blocked ? "badge-danger" : "badge-warning"}>{status}</Badge></div>
    <div className="mt-5 flex flex-wrap gap-3">{active ? <><Button type="button" onClick={() => void test()} disabled={busy} className="rounded-xl bg-[#0878be] text-white"><Bell className="size-4" />Enviar prueba</Button><Button type="button" variant="outline" onClick={() => void deactivate()} disabled={busy} className="rounded-xl bg-white">Desactivar en este dispositivo</Button></> : <Button type="button" onClick={() => void activate()} disabled={busy || blocked} className="rounded-xl bg-[#0878be] text-white"><Bell className="size-4" />Activar alertas</Button>}</div>
    {blocked && <p className="mt-3 rounded-xl bg-[#fff0ec] p-3 text-sm font-semibold text-[#8b3a2d]">{permission === "denied" ? "El navegador bloqueó los avisos. Abrí la configuración del sitio, permití Notificaciones y volvé a esta pantalla." : "Este navegador o la configuración del servidor no admite Web Push."}</p>}
    <div className="mt-6 grid gap-3 md:grid-cols-2">{toggle("vacancies", "Nueva designación compatible")}{toggle("designationRoles", "Nuevo cargo de interés")}{toggle("designationExact", "Coincidencia exacta")}{toggle("designationPartial", "Coincidencia parcial")}{toggle("dateChanges", "Cambio de fecha o estado")}{toggle("trainings", "Capacitaciones compatibles")}{toggle("commissions", "Nuevas comisiones")}{toggle("reminders", "Aperturas y recordatorios")}{toggle("closingSoon", "Cierres próximos")}{toggle("boards", "Padrones y comunicados")}</div>
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-semibold text-[var(--text-secondary)]">Silenciar desde<Input type="time" value={preferences.quietStart} onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.value })} disabled={!active} className="mt-1 h-10 w-36 bg-white" /></label><label className="text-sm font-semibold text-[var(--text-secondary)]">Hasta<Input type="time" value={preferences.quietEnd} onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.value })} disabled={!active} className="mt-1 h-10 w-36 bg-white" /></label><Button type="button" variant="outline" onClick={() => void save()} disabled={!active || busy} className="h-10 rounded-xl bg-white">Guardar preferencias</Button></div>
  </section>;
}

function PublicationSheet({ publication, saved, tracking, match, onClose, onAskAI, onSave, onAgenda, onFollow, onExternal, onEditDesignation }: { publication: Publication | null; saved?: Saved; tracking?: DesignationTracking; match: MatchResult | null; onClose: () => void; onAskAI: (item: Publication) => void; onSave: (item: Publication, enabled: boolean) => void; onAgenda: (item: Publication, enabled: boolean) => void; onFollow: (item: Publication, enabled: boolean) => void; onExternal: (item: Publication) => void; onEditDesignation: (item: Publication) => void }) {
  const training = publication?.kind === "capacitacion" ? parseTrainingMetadata(publication.metadata) : null;
  const documentMetadata = publication?.kind === "junta" ? (() => { try { return JSON.parse(publication.metadata) as { contentAvailable?: boolean; format?: string; itemCount?: number }; } catch { return {}; } })() : null;
  const facts: [string, string | number | undefined | null][] = publication ? publication.kind === "capacitacion" ? [
    ["Estado", publication.status], ["Comisión", training?.commissionId], ["Nivel", publication.level], ["Área", publication.area], ["Modalidad", publication.character],
    ["Inicio", publication.starts_at ? dateLabel(publication.starts_at) : null], ["Finalización", training?.courseEndsAt ? dateLabel(training.courseEndsAt) : null],
    ["Apertura de inscripción", training?.registrationOpensAt ? dateLabel(training.registrationOpensAt, true) : null], ["Cierre de inscripción", training?.registrationClosesAt ? dateLabel(training.registrationClosesAt, true) : null],
    ["Lugar", publication.location], ["Dirección", training?.address], ["Cupo", training?.capacity], ["Cupo de preinscripción", training?.preCapacity],
    ["Carga horaria", training?.hours != null ? `${training.hours} horas cátedra` : null], ["Encuentros", training?.meetings], ["Institución", training?.organization],
  ] : [["Estado", publication.status], ["Nivel / Junta", publication.level || publication.junta], ["Carácter / modalidad", publication.character], ["Turno", publication.shift], ["Lugar", publication.location], ["Cierre", publication.ends_at ? dateLabel(publication.ends_at, true) : null]] : [];
  const insufficient = Boolean(match?.criteria.length && match.criteria.every((criterion) => !criterion.available));
  return <Sheet modal={false} open={Boolean(publication)} onOpenChange={(open) => !open && onClose()}><SheetContent showOverlay={false} onInteractOutside={(event) => event.preventDefault()} className="app-detail-surface w-full overflow-y-auto border-l-[#dce8e1] p-0 sm:max-w-xl"><SheetHeader className="border-b border-[#dce8e1] bg-white p-6 pr-12"><div className="mb-2 flex flex-wrap gap-2"><Badge className="bg-[#edf4ef] text-[#356053]">{publication ? publicationLabel(publication) : "Publicación"}</Badge>{documentMetadata?.contentAvailable && <Badge className="badge-info">Contenido disponible</Badge>}{tracking && <Badge className="badge-info">{tracking.status}</Badge>}{match && <MatchBadge result={match} />}</div><SheetTitle className="text-left text-2xl leading-tight text-[#17362d]">{publication?.title}</SheetTitle><SheetDescription className="text-left">Fuente oficial: {publication?.source}</SheetDescription></SheetHeader>{publication && <div className="space-y-5 p-5 pb-24 md:p-6 md:pb-24"><Button onClick={() => onAskAI(publication)} className="h-11 w-full rounded-xl bg-[#0878be] text-white"><Sparkles className="size-4" />Preguntar a IA sobre esta publicación</Button><div className="grid grid-cols-2 gap-3">{facts.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => <div key={label} className="rounded-2xl border border-[#dce8e1] bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#80938c]">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div><div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">{publication.kind === "junta" ? "Contenido disponible en DocenteTuc" : "Descripción"}</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{publication.summary || "No fue informada por la fuente oficial."}</p></div>{training?.recipients && <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Destinatarios</h3><p className="mt-2 text-sm leading-relaxed text-[#5f756d]">{training.recipients}</p></div>}{training?.content && <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Contenidos</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{training.content}</p></div>}{training?.schedule && <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Cronograma</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{training.schedule}</p></div>}{match && match.status !== "unconfigured" && <div className="rounded-2xl border border-[#c8e1f1] bg-white p-5">{insufficient ? <><h3 className="font-black">Compatibilidad con tu perfil</h3><p className="mt-2 text-sm text-[#52708c]">No hay información suficiente para determinar compatibilidad.</p></> : <><div className="flex items-center justify-between gap-3"><div><h3 className="font-black">¿Por qué coincide?</h3><p className="mt-1 text-sm text-[#52708c]">{match.matched} de {match.total} criterios coinciden.</p></div><strong className="text-2xl text-[#0878be]">{match.score}%</strong></div><div className="mt-4 space-y-2">{match.criteria.map((criterion) => <div key={criterion.key} className="flex gap-3 text-sm"><span className={criterion.matched ? "text-[#277044]" : "text-[#b44b3f]"}>{criterion.matched ? "✓" : "✕"}</span><span><strong>{criterion.label}:</strong> {criterion.expected}{!criterion.available && " (la publicación no informa este dato)"}</span></div>)}</div></>}</div>}<div className="grid gap-2 sm:grid-cols-3"><Button variant={saved ? "default" : "outline"} onClick={() => onSave(publication, !saved)} className="h-11 rounded-xl"><Star className={`size-4 ${saved ? "fill-current" : ""}`} />{saved ? "Guardada" : "Guardar"}</Button><Button variant={Boolean(saved?.in_agenda) ? "default" : "outline"} onClick={() => onAgenda(publication, !Boolean(saved?.in_agenda))} className="h-11 rounded-xl"><CalendarDays className="size-4" />{Boolean(saved?.in_agenda) ? "Quitar de mi agenda" : "Agregar a mi agenda"}</Button>{publication.kind === "junta" && <Button variant={Boolean(saved?.followed) ? "default" : "outline"} onClick={() => onFollow(publication, !Boolean(saved?.followed))} className="h-11 rounded-xl"><Bell className="size-4" />Seguir</Button>}{publication.kind === "vacante" && tracking && <Button variant="outline" onClick={() => onEditDesignation(publication)} className="h-11 rounded-xl">Editar seguimiento</Button>}</div>{publication.kind === "vacante" ? <Button type="button" onClick={() => onExternal(publication)} className="min-h-12 w-full rounded-xl bg-[#17362d] px-5 text-white">Inscribirme en sitio oficial <ExternalLink className="size-4" /></Button> : <a href={publication.official_url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#17362d] px-5 text-center font-bold text-white">{publication.kind === "capacitacion" ? publication.status === "inscripción abierta" && training?.commissionId ? "CONTINUAR INSCRIPCIÓN EN SITIO OFICIAL" : "Ver detalle en sitio oficial" : "Abrir fuente oficial"} <ExternalLink className="size-4" /></a>}<p className="rounded-xl bg-[#fff3dd] p-4 text-sm leading-relaxed text-[#7d541b]">{publication.kind === "vacante" ? "DocenteTuc organiza información pública. Abrir el sitio oficial no marca una inscripción; el estado sólo cambia cuando vos lo confirmás." : publication.kind === "junta" ? "DocenteTuc muestra el contenido público recuperable. Para archivos PDF o carpetas sin texto exportable, la fuente oficial conserva el documento completo." : "La inscripción y cualquier gestión se completan siempre en el sitio oficial."}</p></div>}</SheetContent></Sheet>;
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[#cbdad2] bg-[#f8faf8] p-8 text-center"><div><Search className="mx-auto mb-3 size-7 text-[#799087]" /><p className="font-bold">{title}</p><p className="mx-auto mt-1 max-w-md text-sm text-[#6c847b]">{text}</p></div></div>; }
function LoadingCards() { return <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-52 animate-pulse rounded-3xl border border-[#dce8e1] bg-white p-5"><div className="h-5 w-24 rounded bg-[#e8efeb]" /><div className="mt-8 h-6 w-4/5 rounded bg-[#e8efeb]" /><div className="mt-3 h-4 w-full rounded bg-[#eef3f0]" /></div>)}</div>; }

declare global { interface Document { readonly modelContext?: { registerTool(tool: { name: string; title?: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute(input: unknown): unknown | Promise<unknown> }, options?: { signal?: AbortSignal }): void | Promise<void> } } }
