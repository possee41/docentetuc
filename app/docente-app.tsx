"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { Bell, BookOpen, Bookmark, BriefcaseBusiness, CalendarDays, ChevronRight, Clock3, Download, ExternalLink, GraduationCap, Home, Menu, Moon, RefreshCw, Search, SlidersHorizontal, Star, Sun, UserRound, WifiOff, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarInset, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { Switch } from "@/components/ui/switch";
import { Toaster } from "@/components/ui/sonner";
import { toast } from "sonner";
import { matchesProfile } from "@/lib/matching";
import { safeDate } from "@/lib/safe-date";
import type { AppData, Profile, Publication, Saved } from "@/lib/types";

type View = "inicio" | "vacantes" | "capacitaciones" | "junta" | "agenda" | "alertas" | "guardados" | "perfil";
type Theme = "light" | "dark";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const navigation: [View, string, typeof Home][] = [
  ["inicio", "Inicio", Home], ["vacantes", "Vacantes", BriefcaseBusiness], ["capacitaciones", "Capacitaciones", GraduationCap],
  ["junta", "Junta / Padrones", BookOpen], ["agenda", "Agenda", CalendarDays], ["alertas", "Alertas", Bell], ["guardados", "Mis guardados", Bookmark], ["perfil", "Perfil", UserRound],
];
const viewTitles: Record<View, [string, string]> = {
  inicio: ["Inicio", "Lo más relevante según tus preferencias"], vacantes: ["Vacantes", "Pedidos de cobertura publicados en SIME"],
  capacitaciones: ["Capacitaciones", "Propuestas oficiales de formación docente"], junta: ["Junta / Padrones", "Comunicados, padrones y documentación oficial"],
  agenda: ["Agenda docente", "Fechas y vencimientos de las publicaciones"], alertas: ["Alertas", "Novedades detectadas sin duplicados"],
  guardados: ["Mis guardados", "Publicaciones que elegiste conservar"], perfil: ["Tu perfil docente", "Preferencias usadas para ordenar la información"],
};
const SIME_LOGIN = "https://sime.educaciontuc.gov.ar/Login/Login";
const FDCI_LOGIN = "https://capacitaciondocente.educaciontuc.gov.ar/docentes";

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
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

export default function DocenteApp() {
  const [data, setData] = useState<AppData | null>(null);
  const [view, setView] = useState<View>("inicio");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("para-mi");
  const [level, setLevel] = useState("todos");
  const [character, setCharacter] = useState("todos");
  const [selected, setSelected] = useState<Publication | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [sourceWarning, setSourceWarning] = useState("");
  const [offline, setOffline] = useState(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);

  const load = async (syncIfEmpty = true) => {
    setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/app", { cache: "no-store", headers: apiHeaders() });
      if (!response.ok) throw new Error("No se pudo cargar la información");
      const result = await response.json() as AppData;
      setData(result);
      if (syncIfEmpty && result.publications.length === 0) await syncSources(false);
    } catch (error) { const message = error instanceof Error ? error.message : "No se pudo cargar la información"; setLoadError(message); toast.error(message); }
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
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    void Promise.resolve(context.registerTool({ name: "search_publications", title: "Buscar publicaciones", description: "Busca vacantes, capacitaciones y documentos visibles en DocenteTuc.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input: unknown) { const term = typeof input === "object" && input && "query" in input ? String((input as { query: unknown }).query) : ""; setQuery(term); setView("inicio"); return { query: term, visibleResults: filteredPublications(term).length }; } }, { signal: controller.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({ name: "open_teacher_profile", title: "Abrir perfil docente", description: "Abre el formulario de preferencias del perfil docente.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute() { setView("perfil"); return { opened: true }; } }, { signal: controller.signal })).catch(() => undefined);
    return () => controller.abort();
  }, [data]);

  const savedMap = useMemo(() => new Map((data?.saved || []).map((item) => [item.publication_id, item])), [data]);
  const profile = data?.profile;
  const matches = (publication: Publication) => profile ? matchesProfile({ kind: publication.kind, title: publication.title, summary: publication.summary, level: publication.level, area: publication.area, junta: publication.junta, location: publication.location, shift: publication.shift, character: publication.character }, { level: profile.level, area: profile.area, subjects: profile.subjects, junta: profile.junta, department: profile.department, locality: profile.locality, shifts: profile.shifts, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests }) : false;

  function filteredPublications(search = query) {
    let items = data?.publications || [];
    if (view === "vacantes") items = items.filter((item) => item.kind === "vacante");
    if (view === "capacitaciones") items = items.filter((item) => item.kind === "capacitacion");
    if (view === "junta") items = items.filter((item) => item.kind === "junta");
    if (view === "guardados") items = items.filter((item) => savedMap.has(item.id));
    if (filter === "para-mi") items = items.filter(matches);
    if (filter === "guardadas") items = items.filter((item) => savedMap.has(item.id));
    if (filter === "nuevas") items = items.filter((item) => Date.now() - new Date(`${item.first_seen_at}Z`).getTime() < 7 * 864e5);
    if (filter === "por-vencer") items = items.filter((item) => item.ends_at && new Date(item.ends_at).getTime() > Date.now() && new Date(item.ends_at).getTime() - Date.now() < 3 * 864e5);
    if (level !== "todos") items = items.filter((item) => normalize(item.level + item.junta).includes(normalize(level)));
    if (character !== "todos") items = items.filter((item) => normalize(item.character).includes(normalize(character)));
    if (search.trim()) { const term = normalize(search); items = items.filter((item) => normalize([item.title, item.summary, item.level, item.area, item.junta, item.location, item.character].join(" ")).includes(term)); }
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

  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === "accepted") setInstallPrompt(null); };
  const toggleTheme = () => setTheme((current) => { const next = current === "dark" ? "light" : "dark"; localStorage.setItem("docentetuc-theme", next); document.documentElement.dataset.theme = next; return next; });
  const unread = data?.notifications.filter((notice) => !Boolean(notice.read)).length || 0;
  const items = filteredPublications();
  const levels = [...new Set((data?.publications || []).map((item) => item.level || item.junta).filter(Boolean))].slice(0, 12);
  const greeting = new Date().getHours() < 12 ? "Buenos días" : new Date().getHours() < 20 ? "Buenas tardes" : "Buenas noches";

  return (
    <SidebarProvider style={{ "--sidebar-width": "17rem", "--sidebar": "#0f3d32", "--sidebar-foreground": "#ffffff", "--sidebar-accent": "#d9f36a", "--sidebar-accent-foreground": "#17362d" } as CSSProperties}>
      <Sidebar className="border-r border-white/10 bg-[#0f3d32] text-white" collapsible="offcanvas">
        <SidebarHeader className="p-5"><button onClick={() => setView("inicio")} className="flex items-center gap-3 text-left"><img src="/icon-192.png" alt="" className="size-12 rounded-2xl shadow-sm" /><span><span className="block text-xl font-black">DocenteTuc</span><span className="block text-xs text-white/55">Información docente</span></span></button></SidebarHeader>
        <SidebarContent className="px-3"><SidebarMenu>{navigation.map(([id, label, Icon]) => <SidebarMenuItem key={id}><SidebarMenuButton isActive={view === id} onClick={() => { setView(id); setQuery(""); setFilter(id === "guardados" ? "todas" : "para-mi"); }} className="h-11 rounded-xl bg-white/10 px-3 font-semibold text-white hover:bg-white/20 hover:text-white data-[active=true]:bg-[#d9f36a] data-[active=true]:font-black data-[active=true]:text-[#17362d]"><Icon className="size-5" /><span>{label}</span>{id === "alertas" && unread > 0 && <Badge className="ml-auto bg-[#f5b86d] text-[#17362d]">{unread}</Badge>}</SidebarMenuButton></SidebarMenuItem>)}</SidebarMenu></SidebarContent>
        <SidebarFooter className="p-5"><p className="text-xs leading-relaxed text-white/45">Herramienta independiente. La fuente oficial prevalece siempre.</p></SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#f4f7f5] pb-20 text-[var(--foreground)] md:pb-0">
        <header className="sticky top-0 z-30 flex min-h-20 items-center gap-3 border-b border-[#dce8e1] bg-[#f4f7f5] px-4 md:px-8">
          <SidebarTrigger className="size-11 rounded-xl bg-white md:hidden"><Menu /></SidebarTrigger>
          <div className="relative max-w-2xl flex-1"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#6c847b]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar en DocenteTuc" placeholder="¿Qué estás buscando?" className="h-12 rounded-2xl border-[#dce8e1] bg-white pl-11 shadow-sm" />{query && <button aria-label="Limpiar búsqueda" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-2"><X className="size-4" /></button>}</div>
          {installPrompt && <Button onClick={install} variant="outline" className="hidden h-11 rounded-xl border-[#bdd0c6] bg-white sm:flex"><Download className="size-4" />Instalar</Button>}
          <Button onClick={toggleTheme} size="icon" variant="outline" className="size-11 rounded-xl border-[#dce8e1] bg-white" aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}>{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}</Button>
          <Button onClick={() => setView("alertas")} size="icon" variant="outline" className="relative size-11 rounded-xl border-[#dce8e1] bg-white"><Bell className="size-5" />{unread > 0 && <span className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[#ee6a4b] text-[10px] font-bold text-white">{Math.min(unread, 9)}</span>}<span className="sr-only">Alertas</span></Button>
        </header>

        {offline && <div className="flex items-center justify-center gap-2 bg-[#fff3dd] px-4 py-2 text-sm font-semibold text-[#7d541b]"><WifiOff className="size-4" />Sin conexión. Podés consultar la última información cargada.</div>}

        <div className="mx-auto w-full max-w-7xl p-4 md:p-8">
          {view === "inicio" ? <Dashboard data={data} profile={profile} savedMap={savedMap} matches={matches} greeting={greeting} syncing={syncing} onSync={() => void syncSources()} onRetry={() => void load()} onOpen={(publication) => setSelected(publication)} onView={setView} loading={loading} error={loadError} warning={sourceWarning} /> : view === "perfil" ? <ProfileForm profile={profile} onSaved={() => void load(false)} /> : view === "alertas" ? <Alerts data={data} onOpen={(publication) => setSelected(publication)} onRead={async (id) => { await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "read_notification", id }) }); await load(false); }} /> : view === "agenda" ? <Agenda publications={data?.publications || []} savedMap={savedMap} onOpen={setSelected} /> : <>
            <PageHeader view={view} count={items.length} syncing={syncing} onSync={() => void syncSources()} />
            <Filters filter={filter} setFilter={setFilter} level={level} setLevel={setLevel} character={character} setCharacter={setCharacter} levels={levels} kind={view} />
            <PublicationList items={items} loading={loading} savedMap={savedMap} matches={matches} onOpen={setSelected} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} />
          </>}
        </div>

        <nav className="fixed inset-x-3 bottom-3 z-40 flex h-[68px] rounded-2xl border border-[#dce8e1] bg-white px-1 pb-[env(safe-area-inset-bottom)] shadow-[0_12px_40px_rgba(15,61,50,.18)] md:hidden" aria-label="Navegación móvil">
          {navigation.filter(([id]) => ["inicio", "vacantes", "capacitaciones", "guardados", "perfil"].includes(id)).map(([id, label, Icon]) => <button key={id} onClick={() => setView(id)} aria-current={view === id ? "page" : undefined} className={`flex min-w-0 flex-1 flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-semibold ${view === id ? "bg-[#d9f36a] text-[#17362d]" : "text-[#789087]"}`}><Icon className={`size-5 ${view === id ? "stroke-[2.6]" : ""}`} /><span className="max-w-full truncate px-1">{label.replace("Mis guardados", "Guardados")}</span></button>)}
        </nav>
      </SidebarInset>

      <PublicationSheet publication={selected} saved={selected ? savedMap.get(selected.id) : undefined} match={selected ? matches(selected) : false} onClose={() => setSelected(null)} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} onAgenda={(item, enabled) => void mutateSaved("agenda", item, enabled)} onFollow={(item, enabled) => void mutateSaved("follow", item, enabled)} />
      <Toaster richColors position="top-center" />
    </SidebarProvider>
  );
}

function Dashboard({ data, profile, savedMap, matches, greeting, syncing, onSync, onRetry, onOpen, onView, loading, error, warning }: { data: AppData | null; profile?: Profile; savedMap: Map<string, Saved>; matches: (item: Publication) => boolean; greeting: string; syncing: boolean; onSync: () => void; onRetry: () => void; onOpen: (item: Publication) => void; onView: (view: View) => void; loading: boolean; error: string; warning: string }) {
  const publications = data?.publications || [], upcoming = publications.filter((item) => item.ends_at && new Date(item.ends_at).getTime() > Date.now()).sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime());
  const matchedVacancies = publications.filter((item) => item.kind === "vacante" && item.status === "vigente" && matches(item));
  const training = publications.filter((item) => item.kind === "capacitacion" && item.status === "inscripción abierta");
  const board = publications.filter((item) => item.kind === "junta" && (!profile?.junta || normalize(item.junta).includes(normalize(profile.junta))));
  const latest = [...publications].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 6);
  const important = publications.filter(matches).sort((a, b) => Number(Boolean(b.ends_at)) - Number(Boolean(a.ends_at)) || new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()).slice(0, 4);
  const cards = [["vacantes", `${matchedVacancies.length}`, "Designaciones para tu perfil", BriefcaseBusiness, "bg-[#ffe9e4] text-[#ba4c35]"], ["capacitaciones", `${training.length}`, "Inscripciones abiertas", GraduationCap, "bg-[#e5f1ff] text-[#356ca8]"], ["junta", `${board.length}`, "Padrones y documentos", BookOpen, "bg-[#e9f5e9] text-[#3c7b54]"], ["agenda", upcoming[0] ? dateLabel(upcoming[0].ends_at) : "—", "Próxima fecha importante", CalendarDays, "bg-[#fff3dd] text-[#9a641f]"]] as const;
  if (error && !data) return <section className="grid min-h-[65vh] place-items-center"><div className="max-w-lg rounded-3xl border border-[#ead6b8] bg-white p-8 text-center shadow-sm"><WifiOff className="mx-auto size-10 text-[#b57828]" /><h1 className="mt-4 text-2xl font-black">No pudimos cargar tu panel</h1><p className="mt-2 text-[#61766f]">{error}. Revisá tu conexión y volvé a intentarlo.</p><Button onClick={onRetry} className="mt-6 h-11 rounded-xl bg-[#17362d] px-6 text-white"><RefreshCw className="size-4" />Reintentar</Button></div></section>;
  return <>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><p suppressHydrationWarning className="mb-1 text-sm font-bold uppercase tracking-wide text-[#70867f]">{new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "long" }).format(new Date())}</p><h1 suppressHydrationWarning className="text-3xl font-black tracking-tight md:text-4xl">{greeting}, {profile?.name?.split(" ")[0] || "docente"}</h1><p className="mt-2 text-[#61766f]">Estas coincidencias son orientativas; la habilitación se verifica en los sistemas oficiales.</p></div><Button onClick={onSync} disabled={syncing || loading} className="h-11 rounded-xl bg-[#17362d] px-5 text-white hover:bg-[#275548]"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Actualizando…" : "Actualizar fuentes"}</Button></div>
    {(error || warning) && <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#ead6b8] bg-[#fff8eb] p-4 text-sm font-semibold text-[#7d541b]"><span>{warning || "No pudimos actualizar esta sección. Mostramos la información disponible."}</span><button onClick={onRetry} className="rounded-lg bg-white px-3 py-2 font-bold">Reintentar</button></div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">{cards.map(([target, value, label, Icon, color]) => <button key={label} onClick={() => onView(target)} className="rounded-3xl border border-[#dce8e1] bg-white p-5 text-left shadow-[0_8px_30px_rgba(20,64,52,.06)] hover:-translate-y-0.5"><div className="mb-7 flex items-start justify-between"><span className={`grid size-11 place-items-center rounded-2xl ${color}`}><Icon className="size-5" /></span><ChevronRight className="size-5 text-[#9aaca5]" /></div><p className="text-2xl font-black">{loading ? "…" : value}</p><p className="mt-1 text-sm text-[#61766f]">{label}</p></button>)}</section>
    <div className="mt-7 grid gap-5 xl:grid-cols-2"><HomeSection title="Importante para vos" subtitle="Priorizado según tu perfil docente" items={important} loading={loading} savedMap={savedMap} onOpen={onOpen} empty="Completá tu perfil para recibir información priorizada." /><HomeSection title="Próximas fechas" subtitle="Vencimientos e inscripciones cercanas" items={upcoming.slice(0, 4)} loading={loading} savedMap={savedMap} onOpen={onOpen} empty="No hay fechas próximas informadas." /></div>
    <section className="mt-5 rounded-3xl border border-[#dce8e1] bg-white p-5 md:p-7"><div className="mb-5 flex items-end justify-between gap-3"><div><h2 className="text-xl font-bold">Últimas publicaciones</h2><p className="mt-1 text-sm text-[#6c847b]">Novedades oficiales reunidas en un solo lugar.</p></div>{data?.sync[0] && <span className="hidden text-xs text-[#789087] sm:block">Actualizado {dateLabel(`${data.sync[0].synced_at}Z`, true)}</span>}</div>{loading ? <LoadingCards /> : latest.length ? <div className="divide-y divide-[#e7eee9]">{latest.map((item) => <CompactItem key={item.id} item={item} saved={savedMap.has(item.id)} onOpen={() => onOpen(item)} />)}</div> : <Empty title="Todavía no hay publicaciones" text="Actualizá las fuentes para cargar información oficial." />}</section>
  </>;
}

function HomeSection({ title, subtitle, items, loading, savedMap, onOpen, empty }: { title: string; subtitle: string; items: Publication[]; loading: boolean; savedMap: Map<string, Saved>; onOpen: (item: Publication) => void; empty: string }) {
  return <section className="rounded-3xl border border-[#dce8e1] bg-white p-5 md:p-7"><h2 className="text-xl font-bold">{title}</h2><p className="mt-1 text-sm text-[#6c847b]">{subtitle}</p><div className="mt-4">{loading ? <LoadingRows /> : items.length ? <div className="divide-y divide-[#e7eee9]">{items.map((item) => <CompactItem key={item.id} item={item} saved={savedMap.has(item.id)} onOpen={() => onOpen(item)} />)}</div> : <Empty title="Sin novedades" text={empty} />}</div></section>;
}

function PageHeader({ view, count, syncing = false, onSync }: { view: View; count: number; syncing?: boolean; onSync?: () => void }) { const [title, subtitle] = viewTitles[view]; return <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-3xl font-black tracking-tight">{title}</h1><p className="mt-1 text-[#61766f]">{subtitle} · {count} resultados</p></div>{onSync && <Button onClick={onSync} disabled={syncing} variant="outline" className="rounded-xl border-[#bfd1c7] bg-white"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />Actualizar</Button>}</div>; }

function Filters({ filter, setFilter, level, setLevel, character, setCharacter, levels, kind }: { filter: string; setFilter: (value: string) => void; level: string; setLevel: (value: string) => void; character: string; setCharacter: (value: string) => void; levels: string[]; kind: View }) {
  return <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-[#dce8e1] bg-white p-3"><SlidersHorizontal className="mx-2 mt-2 size-4 text-[#789087]" />{[["para-mi", "Para mí"], ["todas", "Todas"], ["nuevas", "Nuevas"], ["guardadas", "Guardadas"], ["por-vencer", "Por vencer"]].map(([id, label]) => <button key={id} onClick={() => setFilter(id)} className={`min-h-9 rounded-xl px-3 text-sm font-semibold ${filter === id ? "bg-[#17362d] text-white" : "bg-[#f1f5f2] text-[#5f756d]"}`}>{label}</button>)}
    {!["junta", "guardados"].includes(kind) && <Select value={level} onValueChange={(value) => setLevel(value || "todos")}><SelectTrigger className="ml-auto h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Nivel" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos los niveles</SelectItem>{levels.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select>}
    {["vacantes", "capacitaciones"].includes(kind) && <Select value={character} onValueChange={(value) => setCharacter(value || "todos")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Carácter" /></SelectTrigger><SelectContent><SelectItem value="todos">Todo carácter/modalidad</SelectItem>{kind === "vacantes" ? <><SelectItem value="interino">Interino</SelectItem><SelectItem value="suplente">Suplente</SelectItem></> : <><SelectItem value="virtual">Virtual</SelectItem><SelectItem value="presencial">Presencial</SelectItem><SelectItem value="semipresencial">Semipresencial</SelectItem></>}</SelectContent></Select>}
  </div>;
}

function PublicationList({ items, loading, savedMap, matches, onOpen, onSave }: { items: Publication[]; loading: boolean; savedMap: Map<string, Saved>; matches: (item: Publication) => boolean; onOpen: (item: Publication) => void; onSave: (item: Publication, enabled: boolean) => void }) {
  if (loading) return <LoadingCards />; if (!items.length) return <Empty title="No encontramos resultados" text="Probá con otra búsqueda o cambiá los filtros." />;
  return <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => { const saved = savedMap.has(item.id); return <article key={item.id} className="flex min-h-[230px] flex-col rounded-3xl border border-[#dce8e1] bg-white p-5 shadow-[0_8px_30px_rgba(20,64,52,.04)]"><div className="mb-4 flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><Badge variant="secondary" className="bg-[#edf4ef] text-[#356053]">{item.category}</Badge><Badge variant="outline" className={item.status === "vigente" || item.status === "inscripción abierta" ? "border-[#b9d9c4] bg-[#edf8f0] text-[#34724b]" : "border-[#dfd8c9] text-[#7e7462]"}>{item.status}</Badge>{matches(item) && <Badge className="bg-[#d9f36a] text-[#17362d]">Coincide con tus preferencias</Badge>}</div><button onClick={() => onSave(item, !saved)} aria-label={saved ? "Quitar de guardados" : "Guardar publicación"} className={`grid size-10 shrink-0 place-items-center rounded-xl ${saved ? "bg-[#fff3dd] text-[#a46c20]" : "bg-[#f1f5f2] text-[#6d837a]"}`}><Star className={`size-5 ${saved ? "fill-current" : ""}`} /></button></div><button onClick={() => onOpen(item)} className="text-left"><h2 className="line-clamp-2 text-lg font-bold leading-snug hover:underline">{item.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#657b73]">{item.summary || `Información publicada por ${item.source}.`}</p></button><div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-2 pt-5 text-sm text-[#61766f]">{item.character && <span>{item.character}</span>}{item.junta && <span>{item.junta}</span>}{item.shift && <span>Turno {item.shift}</span>}{item.ends_at && <span className="ml-auto flex items-center gap-1 font-semibold text-[#9a641f]"><Clock3 className="size-4" />{fromNow(item.ends_at)}</span>}</div><div className="mt-4 flex items-center justify-between border-t border-[#e7eee9] pt-4"><span className="text-xs font-semibold uppercase tracking-wide text-[#82958e]">Fuente: {item.source}</span><a href={item.official_url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#1f5f4e] hover:bg-[#edf4ef]">{item.kind === "capacitacion" ? "Inscribirme en el sitio oficial" : item.kind === "vacante" ? "Continuar en SIME" : "Ver oficial"} <ExternalLink className="size-4" /></a></div></article>; })}</div>;
}

function CompactItem({ item, saved, onOpen }: { item: Publication; saved: boolean; onOpen: () => void }) { return <button onClick={onOpen} className="flex w-full items-center gap-4 py-4 text-left"><span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${item.kind === "vacante" ? "bg-[#ffe9e4] text-[#ba4c35]" : item.kind === "capacitacion" ? "bg-[#e5f1ff] text-[#356ca8]" : "bg-[#e9f5e9] text-[#3c7b54]"}`}>{item.kind === "vacante" ? <BriefcaseBusiness className="size-5" /> : item.kind === "capacitacion" ? <GraduationCap className="size-5" /> : <BookOpen className="size-5" />}</span><span className="min-w-0 flex-1"><span className="line-clamp-1 font-bold">{item.title}</span><span className="mt-1 block text-sm text-[#6c847b]">{item.ends_at ? fromNow(item.ends_at) : item.category} · {item.source}</span></span>{saved && <Star className="size-4 fill-[#e9a33c] text-[#e9a33c]" />}<ChevronRight className="size-5 text-[#9bada6]" /></button>; }

function Agenda({ publications, savedMap, onOpen }: { publications: Publication[]; savedMap: Map<string, Saved>; onOpen: (item: Publication) => void }) {
  const items = publications.filter((item) => item.ends_at && new Date(item.ends_at).getTime() > Date.now()).sort((a, b) => new Date(a.ends_at!).getTime() - new Date(b.ends_at!).getTime());
  return <><PageHeader view="agenda" count={items.length} syncing={false} onSync={() => undefined} /><div className="rounded-3xl border border-[#dce8e1] bg-white p-4 md:p-7">{items.length ? <div className="space-y-1">{items.map((item) => <button key={item.id} onClick={() => onOpen(item)} className="flex w-full gap-4 rounded-2xl p-3 text-left hover:bg-[#f3f7f4]"><span className="grid h-14 w-16 shrink-0 place-items-center rounded-2xl bg-[#fff3dd] text-center"><span><strong className="block text-lg leading-none">{new Date(item.ends_at!).getDate()}</strong><small className="uppercase">{new Intl.DateTimeFormat("es-AR", { month: "short" }).format(new Date(item.ends_at!))}</small></span></span><span className="min-w-0 flex-1"><span className="line-clamp-1 font-bold">{item.title}</span><span className="mt-1 block text-sm text-[#6c847b]">{item.category} · {dateLabel(item.ends_at, true)}</span></span>{Boolean(savedMap.get(item.id)?.in_agenda) && <Badge className="bg-[#d9f36a] text-[#17362d]">Mi agenda</Badge>}</button>)}</div> : <Empty title="No hay fechas próximas" text="Las fechas oficiales aparecerán automáticamente al sincronizar." />}</div></>;
}

function Alerts({ data, onOpen, onRead }: { data: AppData | null; onOpen: (item: Publication) => void; onRead: (id: number) => void }) { const publicationMap = new Map((data?.publications || []).map((item) => [item.id, item])); return <><PageHeader view="alertas" count={data?.notifications.length || 0} syncing={false} onSync={() => undefined} /><div className="rounded-3xl border border-[#dce8e1] bg-white p-4 md:p-6">{data?.notifications.length ? <div className="divide-y divide-[#e7eee9]">{data.notifications.map((notice) => <button key={notice.id} onClick={() => { const item = publicationMap.get(notice.publication_id); if (item) onOpen(item); if (!Boolean(notice.read)) void onRead(notice.id); }} className="flex w-full gap-4 py-4 text-left"><span className={`mt-1 size-2 shrink-0 rounded-full ${Boolean(notice.read) ? "bg-[#c7d2cd]" : "bg-[#ee6a4b]"}`} /><span className="flex-1"><span className="block font-bold">{notice.title}</span><span className="mt-1 block text-sm text-[#6c847b]">{notice.type.replaceAll("_", " ")} · {dateLabel(`${notice.created_at}Z`, true)}</span></span><ChevronRight className="size-5 text-[#9bada6]" /></button>)}</div> : <Empty title="No hay alertas nuevas" text="Las alertas aparecen cuando una publicación coincide con tu perfil o cambia un documento seguido." />}</div></>; }

function ProfileForm({ profile, onSaved }: { profile?: Profile; onSaved: () => void }) {
  const [form, setForm] = useState(profile || null); useEffect(() => setForm(profile || null), [profile]);
  if (!form) return <LoadingCards />;
  const field = (key: keyof Profile, label: string, placeholder: string) => <div className="space-y-2"><Label htmlFor={String(key)}>{label}</Label><Input id={String(key)} value={String(form[key] || "")} onChange={(event) => setForm({ ...form, [key]: event.target.value })} placeholder={placeholder} className="h-11 rounded-xl border-[#cddbd3] bg-white" /></div>;
  const save = async () => { const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "save_profile", name: form.name, level: form.level, area: form.area, subjects: form.subjects, junta: form.junta, department: form.department, locality: form.locality, shifts: form.shifts, wantsInterim: Boolean(form.wants_interim), wantsSubstitute: Boolean(form.wants_substitute), trainingInterests: form.training_interests }) }); if (response.ok) { toast.success("Perfil actualizado"); onSaved(); } else toast.error("No se pudo actualizar el perfil"); };
  return <><PageHeader view="perfil" count={0} syncing={false} onSync={() => undefined} /><section className="mb-5 rounded-3xl border border-[#dce8e1] bg-[#f3f7f4] p-5 md:p-6"><h2 className="text-lg font-bold">Ya tengo cuenta oficial</h2><p className="mt-1 text-sm text-[#61766f]">Ingresá con tu cuenta existente directamente en el sistema correspondiente. DocenteTuc nunca recibe tu contraseña.</p><div className="mt-4 flex flex-wrap gap-3"><a href={FDCI_LOGIN} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl bg-[#17362d] px-4 font-bold text-white">Ingresar a FDCI <ExternalLink className="size-4" /></a><a href={SIME_LOGIN} target="_blank" rel="noreferrer" className="flex min-h-11 items-center gap-2 rounded-xl border border-[#bfd1c7] bg-white px-4 font-bold text-[#17362d]">Ingresar a SIME <ExternalLink className="size-4" /></a></div></section><form onSubmit={(event) => { event.preventDefault(); void save(); }} className="grid gap-5 rounded-3xl border border-[#dce8e1] bg-white p-5 md:grid-cols-2 md:p-8">{field("name", "Nombre", "Tu nombre")}{field("level", "Nivel educativo", "Ej. Secundario")}{field("area", "Área", "Ej. Ciencias Sociales")}{field("subjects", "Materias o espacios de interés", "Separá varios con comas")}{field("junta", "Junta correspondiente", "Ej. Secundaria")}{field("department", "Departamento / zona", "Ej. Capital")}{field("locality", "Localidad", "Ej. San Miguel de Tucumán")}{field("shifts", "Turnos de interés", "Mañana, tarde, noche")}{field("training_interests", "Capacitaciones de interés", "Temas separados por comas")}<div className="flex flex-col justify-center gap-4 rounded-2xl bg-[#f3f7f4] p-4"><label className="flex items-center justify-between gap-4"><span><strong className="block">Interinatos</strong><small className="text-[#6c847b]">Incluir en coincidencias</small></span><Switch checked={Boolean(form.wants_interim)} onCheckedChange={(checked) => setForm({ ...form, wants_interim: checked })} /></label><label className="flex items-center justify-between gap-4"><span><strong className="block">Suplencias</strong><small className="text-[#6c847b]">Incluir en coincidencias</small></span><Switch checked={Boolean(form.wants_substitute)} onCheckedChange={(checked) => setForm({ ...form, wants_substitute: checked })} /></label></div><div className="md:col-span-2 flex flex-wrap items-center justify-between gap-4 border-t border-[#e2ebe5] pt-5"><p className="max-w-xl text-sm text-[#6c847b]">Las coincidencias no certifican habilitación legal. Nunca solicitamos tu contraseña de SIME ni de FDCI.</p><Button type="submit" className="h-11 rounded-xl bg-[#17362d] px-6 text-white">Guardar preferencias</Button></div></form></>;
}

function PublicationSheet({ publication, saved, match, onClose, onSave, onAgenda, onFollow }: { publication: Publication | null; saved?: Saved; match: boolean; onClose: () => void; onSave: (item: Publication, enabled: boolean) => void; onAgenda: (item: Publication, enabled: boolean) => void; onFollow: (item: Publication, enabled: boolean) => void }) {
  return <Sheet open={Boolean(publication)} onOpenChange={(open) => !open && onClose()}><SheetContent className="w-full overflow-y-auto border-l-[#dce8e1] bg-[#f8faf8] p-0 sm:max-w-xl"><SheetHeader className="border-b border-[#dce8e1] bg-white p-6 pr-12"><div className="mb-2 flex flex-wrap gap-2"><Badge className="bg-[#edf4ef] text-[#356053]">{publication?.category}</Badge>{match && <Badge className="bg-[#d9f36a] text-[#17362d]">Podría interesarte</Badge>}</div><SheetTitle className="text-left text-2xl leading-tight text-[#17362d]">{publication?.title}</SheetTitle><SheetDescription className="text-left">Fuente: {publication?.source}</SheetDescription></SheetHeader>{publication && <div className="space-y-5 p-5 md:p-6"><div className="grid grid-cols-2 gap-3">{[["Estado", publication.status], ["Nivel / Junta", publication.level || publication.junta], ["Carácter / modalidad", publication.character], ["Turno", publication.shift], ["Lugar", publication.location], ["Cierre", dateLabel(publication.ends_at, true)]].filter(([, value]) => value).map(([label, value]) => <div key={label} className="rounded-2xl border border-[#dce8e1] bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#80938c]">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div><div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Detalle publicado</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{publication.summary || "La fuente no ofrece una descripción adicional."}</p></div><div className="grid gap-2 sm:grid-cols-3"><Button variant={saved ? "default" : "outline"} onClick={() => onSave(publication, !saved)} className="h-11 rounded-xl"><Star className={`size-4 ${saved ? "fill-current" : ""}`} />{saved ? "Guardada" : "Guardar"}</Button><Button variant={Boolean(saved?.in_agenda) ? "default" : "outline"} onClick={() => onAgenda(publication, !Boolean(saved?.in_agenda))} className="h-11 rounded-xl"><CalendarDays className="size-4" />Agenda</Button>{publication.kind === "junta" && <Button variant={Boolean(saved?.followed) ? "default" : "outline"} onClick={() => onFollow(publication, !Boolean(saved?.followed))} className="h-11 rounded-xl"><Bell className="size-4" />Seguir</Button>}</div><a href={publication.official_url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#17362d] px-5 font-bold text-white">{publication.kind === "capacitacion" ? "Inscribirme en el sitio oficial" : publication.kind === "vacante" ? "Continuar en SIME" : "Ver publicación oficial"} <ExternalLink className="size-4" /></a><p className="rounded-xl bg-[#fff3dd] p-4 text-sm leading-relaxed text-[#7d541b]">DocenteTuc organiza información pública. La inscripción, postulación y verificación de requisitos se realizan exclusivamente en el sistema oficial.</p></div>}</SheetContent></Sheet>;
}

function Empty({ title, text }: { title: string; text: string }) { return <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-[#cbdad2] bg-[#f8faf8] p-8 text-center"><div><Search className="mx-auto mb-3 size-7 text-[#799087]" /><p className="font-bold">{title}</p><p className="mx-auto mt-1 max-w-md text-sm text-[#6c847b]">{text}</p></div></div>; }
function LoadingRows() { return <div className="space-y-3">{[1, 2, 3].map((item) => <div key={item} className="flex animate-pulse items-center gap-4 py-3"><div className="size-11 rounded-2xl bg-[#e8efeb]" /><div className="flex-1"><div className="h-4 w-4/5 rounded bg-[#e8efeb]" /><div className="mt-2 h-3 w-2/5 rounded bg-[#eef3f0]" /></div></div>)}</div>; }
function LoadingCards() { return <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-52 animate-pulse rounded-3xl border border-[#dce8e1] bg-white p-5"><div className="h-5 w-24 rounded bg-[#e8efeb]" /><div className="mt-8 h-6 w-4/5 rounded bg-[#e8efeb]" /><div className="mt-3 h-4 w-full rounded bg-[#eef3f0]" /></div>)}</div>; }

declare global { interface Document { readonly modelContext?: { registerTool(tool: { name: string; title?: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute(input: unknown): unknown | Promise<unknown> }, options?: { signal?: AbortSignal }): void | Promise<void> } } }
