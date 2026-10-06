"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Bell, BookOpen, Bookmark, BriefcaseBusiness, Building2, CalendarDays, ChevronRight, Clock3, Download, ExternalLink, GraduationCap, Home, KeyRound, Mail, MapPin, Menu, MessagesSquare, Moon, Phone, RefreshCw, Search, SlidersHorizontal, Sparkles, Star, Sun, UserRound, WifiOff, X } from "lucide-react";
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
import { AIWidget, AppBackground } from "@/components/app-chrome";
import type { AIContext } from "@/components/app-chrome";
import { DocenteTucAIChatPanel } from "@/components/docentetuc-ai-panel";
import type { AIAssistantAction } from "@/components/docentetuc-ai-panel";
import { toast } from "sonner";
import { designationRoleFromTitle, isEligibleForPersonalizedHome, isEligibleMatchResult, profileMatch } from "@/lib/matching";
import { isGeneralNotice } from "@/lib/notice-classification";
import type { MatchResult } from "@/lib/matching";
import { safeDate } from "@/lib/safe-date";
import { enrollmentState, openingCountdown, parseTrainingMetadata, trainingReminderKey } from "@/lib/training";
import { calendarDayDistance, compareHomePriority, homePriority, registrationState } from "@/lib/home-dashboard";
import { DESIGNATION_STATUSES, designationFacts } from "@/lib/designations";
import { circuitMatches, inferCircuit, TUCUMAN_CIRCUITS } from "@/lib/circuits";
import { OFFICIAL_CHARACTERS, OFFICIAL_JUNTAS, matchesCharacter, matchesJunta, normalizeJunta, normalizeSearchText } from "@/lib/juntas";
import type { DesignationTracking } from "@/lib/types";
import type { AppData, ManualEvent, Notice, Profile, Publication, Saved, SyncStatus, TrainingReminder } from "@/lib/types";
import { usefulMetadata } from "@/lib/useful-information";
import { canRecommendCurrentPublication, publicationLifecycle } from "@/lib/publication-lifecycle";
import { designationEmptyState, hasDesignationProfilePreferences } from "@/lib/designation-state";
import { AppHeader, BottomNavigation, Card, CompatibilityBadge, EmptyState, FilterChip, StatusBadge } from "@/components/docentetuc-ui";
import { HomeBannerContext } from "@/components/home-banner-context";
import { PublicProfileSection } from "@/components/public-profile-section";
import { AccountSignInSection } from "@/components/account-sign-in-section";
import { GoogleAccountPhoto } from "@/components/google-account-photo";

type View = "inicio" | "vacantes" | "comunidad" | "capacitaciones" | "junta" | "informacion" | "agenda" | "alertas" | "guardados" | "perfil" | "cuentas";
type Theme = "light" | "dark";
type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const navigation: [View, string, typeof Home][] = [
  ["inicio", "Inicio", Home], ["vacantes", "Designaciones", BriefcaseBusiness], ["comunidad", "Comunidad", MessagesSquare], ["capacitaciones", "Capacitaciones", GraduationCap],
  ["junta", "Padrones y comunicados", BookOpen], ["informacion", "Información útil", Building2], ["agenda", "Agenda", CalendarDays], ["guardados", "Mis guardados", Bookmark], ["perfil", "Perfil docente", UserRound], ["cuentas", "Cuentas y accesos", KeyRound],
];
const viewTitles: Record<View, [string, string]> = {
  inicio: ["Inicio", "Lo más relevante según tus preferencias"], vacantes: ["Designaciones", "Pedidos de cobertura publicados en SIME"],
  capacitaciones: ["Capacitaciones", "Formación docente"], junta: ["Padrones y comunicados", "Llamados abiertos, padrones, comunicados y documentación oficial"],
  informacion: ["Información útil", "Organismos, trámites y servicios oficiales organizados por necesidad"],
  agenda: ["Agenda docente", "Fechas y vencimientos de las publicaciones"], alertas: ["Alertas", "Novedades detectadas sin duplicados"],
  guardados: ["Mis guardados", "Publicaciones que elegiste conservar"], perfil: ["Tu perfil docente", "Preferencias usadas para ordenar la información"], cuentas: ["Cuentas y accesos", "Gestioná la identidad DocenteTuc y los servicios externos"],
  comunidad: ["Comunidad Docente", "Preguntá, compartí y ayudá a otros docentes"],
};
const viewFromSection = (section?: string): View => {
  const allowed: View[] = ["inicio", "vacantes", "comunidad", "capacitaciones", "junta", "informacion", "agenda", "alertas", "guardados", "perfil", "cuentas"];
  return allowed.includes(section as View) ? section as View : "inicio";
};
const SIME_LOGIN = "https://sime.educaciontuc.gov.ar/Login/Login";
const FDCI_LOGIN = "https://capacitaciondocente.educaciontuc.gov.ar/docentes";
const INFOD_LOGIN = "https://aulastic.infd.edu.ar/";
const EDUCATION_LEVELS = ["Inicial", "Primario", "Secundario", "Superior"];

function AppSidebarNavigation({ view, onNavigate }: { view: View; onNavigate: (view: View) => void }) {
  const { setOpen, setOpenMobile } = useSidebar();
  const groups: [string, View[]][] = [["Uso diario", ["inicio", "vacantes", "comunidad", "capacitaciones", "agenda"]], ["Consultas", ["junta", "informacion"]], ["Personal", ["perfil", "guardados", "cuentas"]]];
  return <SidebarMenu>{groups.map(([group, ids]) => <div key={group} className="mb-4"><p className="px-3 pb-1 text-[10px] font-black uppercase tracking-[.16em] text-white/45">{group}</p>{ids.map((id) => { const entry = navigation.find(([itemId]) => itemId === id)!; const [, label, Icon] = entry; return <SidebarMenuItem key={id}><SidebarMenuButton isActive={view === id} onClick={() => { onNavigate(id); setOpen(false); setOpenMobile(false); }} className="h-10 rounded-xl bg-white/8 px-3 font-semibold text-white hover:bg-white/15 hover:text-white data-[active=true]:bg-[#2eb6f3] data-[active=true]:font-black data-[active=true]:text-white"><Icon className="size-5" /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>; })}</div>)}</SidebarMenu>;
}

const normalize = (value = "") => value.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
const publicationCircuitMatch = (item: Publication, circuit: string) => {
  if (item.circuit === "ALL") return true;
  const direct = item.circuit && /^[iv]+$|^[1-5]$/i.test(item.circuit) ? `Circuito ${item.circuit}` : item.source_circuit_raw || "";
  const inference = inferCircuit({ explicit: direct, locality: item.location || item.source_circuit_raw || "" });
  return circuitMatches(inference, [circuit]) === true;
};
const publicationLabel = (item: Publication) => item.kind === "vacante" ? (normalize(item.category).includes("llamado") ? "LLAMADO ABIERTO" : "DESIGNACIÓN") : item.kind === "capacitacion" ? "CAPACITACIÓN" : item.kind === "informacion" ? item.category.toUpperCase() : item.category.toUpperCase();
const publicationSearchText = (item: Publication) => [item.title, item.summary, item.level, item.area, item.junta, item.location, item.character, item.category, item.source, item.metadata, item.circuit, item.source_circuit_raw, item.kind === "vacante" ? "designaciones vacantes" : "", Date.now() - new Date(`${item.updated_at}Z`).getTime() < 30 * 864e5 ? "novedades" : ""].join(" ");
const simeCodeForPublication = (item?: Pick<Publication, "metadata"> | null) => {
  if (!item?.metadata) return "";
  try { const parsed = JSON.parse(item.metadata) as { simeCode?: unknown }; return typeof parsed.simeCode === "string" ? parsed.simeCode.trim() : ""; } catch { return ""; }
};
const trainingPlatform = (source: string) => { const key = normalize(source); return /cenet|inet/.test(key) ? "cenet" : /infod|aulastic/.test(key) ? "infod" : /fdci|capacitacion docente/.test(key) ? "fdci" : "other"; };
const apiHeaders = (json = false) => {
  let deviceId = localStorage.getItem("docentetuc-device-id");
  if (!deviceId) { deviceId = crypto.randomUUID(); localStorage.setItem("docentetuc-device-id", deviceId); }
  return { "X-DocenteTuc-Device": deviceId, ...(json ? { "Content-Type": "application/json" } : {}) };
};
const dateLabel = (value: string | null, withTime = false) => { const date = safeDate(value); return date ? new Intl.DateTimeFormat("es-AR", { timeZone: "America/Argentina/Tucuman", day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : {}) }).format(date) : "Sin fecha informada"; };
const fromNow = (value: string | null) => {
  const date = safeDate(value); if (!date) return "Sin fecha informada"; const hours = Math.ceil((date.getTime() - Date.now()) / 36e5);
  return hours <= 0 ? "Finalizó" : hours < 24 ? `Vence en ${hours} h` : `Vence en ${Math.ceil(hours / 24)} días`;
};
const tucumanDay = (value: Date | string) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(typeof value === "string" ? new Date(value) : value);
const opensToday = (item: Publication) => { const opens = parseTrainingMetadata(item.metadata)?.registrationOpensAt; return Boolean(opens && tucumanDay(opens) === tucumanDay(new Date())); };
const healthNameForPublication = (item: Publication) => item.source === "Padrones y Comunicados" ? item.category : item.source;
const healthForPublication = (item: Publication, sync: SyncStatus[]) => sync.find((source) => source.source === healthNameForPublication(item));
const publicationLifecycleForUI = (item: Publication, now = new Date()) => {
  const metadata = parseTrainingMetadata(item.metadata);
  const designation = item.kind === "vacante";
  return publicationLifecycle({
    normalizedStatus: item.normalized_status,
    sourceStatus: item.source_status || item.status,
    sourceStatusIsExplicit: true,
    registrationOpenAt: designation ? item.starts_at : metadata?.registrationOpensAt,
    registrationCloseAt: designation ? item.ends_at : metadata?.registrationClosesAt,
    expiresAt: designation ? item.ends_at : metadata?.courseEndsAt,
    dateStatus: designation ? "confirmed" : metadata?.dateStatus,
    now,
  });
};
const enrollmentForUI = (item: Publication, now = new Date()) => enrollmentState(parseTrainingMetadata(item.metadata), item.source_status || item.status, item.normalized_status, now);
const enrollmentLabel = (item: Publication, now = new Date()) => {
  const state = enrollmentForUI(item, now), tentative = parseTrainingMetadata(item.metadata)?.dateStatus === "tentative";
  return state === "PROXIMAMENTE" ? tentative ? "Preinscripción prevista · fecha tentativa" : "Próximamente"
    : state === "ABRE_HOY" ? tentative ? "Apertura prevista hoy · confirmar en fuente" : "Abre hoy"
    : state === "ABIERTA" ? "Inscripción abierta" : state === "CERRADA" ? "Inscripción cerrada" : "Fecha de inscripción no confirmada";
};
const lifecycleLabel = (status: ReturnType<typeof publicationLifecycle>) => ({ ACTIVE: "Vigente", UPCOMING: "Próxima apertura", CLOSED: "Cerrada", EXPIRED: "Vencida", REMOVED_FROM_SOURCE: "Ya no aparece en la fuente", UNKNOWN: "Estado sin confirmar" })[status];

export default function DocenteApp({ initialSection }: { initialSection?: string }) {
  const router = useRouter();
  const [data, setData] = useState<AppData | null>(null);
  const [accountPhoto, setAccountPhoto] = useState<{ authenticated: boolean; image: string | null }>({ authenticated: false, image: null });
  const [view, setView] = useState<View>(() => viewFromSection(initialSection));
  const [query, setQuery] = useState("");
  const [designationQuery, setDesignationQuery] = useState("");
  const [filter, setFilter] = useState("para-mi");
  const [juntaFilter, setJuntaFilter] = useState<(typeof OFFICIAL_JUNTAS)[number]["id"] | "todas">("todas");
  const [designationCircuit, setDesignationCircuit] = useState("todos");
  const [character, setCharacter] = useState("todos");
  const [trainingDate, setTrainingDate] = useState("");
  const [trainingCircuit, setTrainingCircuit] = useState("todos");
  const [trainingSource, setTrainingSource] = useState("todas");
  const [trainingCompatibility, setTrainingCompatibility] = useState("todas");
  const [trainingSort, setTrainingSort] = useState("recommended");
  const [selected, setSelected] = useState<Publication | null>(null);
  const [reminderPublication, setReminderPublication] = useState<Publication | null>(null);
  const [reminderAdvances, setReminderAdvances] = useState<number[]>([10080, 4320, 1440, 60, 0]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [offline, setOffline] = useState(false);
  const autoSyncStarted = useRef(false);
  const [theme, setTheme] = useState<Theme>("light");
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [aiMode, setAIMode] = useState<"closed" | "minimized" | "expanded">("closed");
  const [aiContext, setAIContext] = useState<AIContext>({ type: "inicio", title: viewTitles.inicio[0] });
  const [returnPublication, setReturnPublication] = useState<Publication | null>(null);
  const [trackingPublication, setTrackingPublication] = useState<Publication | null>(null);
  const [agendaPublication, setAgendaPublication] = useState<Publication | null>(null);
  const [agendaAt, setAgendaAt] = useState("");
  const [agendaNotes, setAgendaNotes] = useState("");
  const [agendaReminder, setAgendaReminder] = useState("one_day");
  const [manualEvent, setManualEvent] = useState<ManualEvent | null | "new">(null);
  const [manualEventDate, setManualEventDate] = useState("");
  const loadRef = useRef<(syncIfEmpty?: boolean, showLoading?: boolean) => Promise<void>>(async () => {});
  const syncSourcesRef = useRef<(notify?: boolean) => Promise<void>>(async () => {});
  const refreshAccountPhoto = useCallback(async () => {
    try {
      const response = await fetch("/api/auth/status", { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) throw new Error("No se pudo consultar el estado de la cuenta.");
      const status = await response.json() as { authenticated?: unknown; image?: unknown };
      setAccountPhoto({ authenticated: Boolean(status.authenticated), image: typeof status.image === "string" ? status.image : null });
    } catch {
      setAccountPhoto({ authenticated: false, image: null });
    }
  }, []);
  useEffect(() => { const openProfile = () => setView("perfil"); window.addEventListener("docentetuc:open-profile", openProfile); return () => window.removeEventListener("docentetuc:open-profile", openProfile); }, []);
  useEffect(() => {
    queueMicrotask(() => { void refreshAccountPhoto(); });
    window.addEventListener("docentetuc:refresh-auth-status", refreshAccountPhoto);
    return () => window.removeEventListener("docentetuc:refresh-auth-status", refreshAccountPhoto);
  }, [refreshAccountPhoto]);
  const openPublication = (publication: Publication) => { setSelected(publication); history.pushState({ publicationId: publication.id }, "", `#publicacion-${encodeURIComponent(publication.id)}`); };
  const closePublication = () => { if (history.state?.publicationId) history.back(); else setSelected(null); };

  const load = useCallback(async (syncIfEmpty = true, showLoading = true) => {
    if (showLoading) setLoading(true);
    setLoadError("");
    try {
      const response = await fetch("/api/app", { cache: "no-store", headers: apiHeaders() });
      if (!response.ok) throw new Error("No se pudo cargar la información");
      const result = await response.json() as AppData;
      result.designations ||= []; result.manualEvents ||= []; if (result.profile) result.profile.roles ||= [];
      const deepLinkId = new URLSearchParams(location.search).get("publication"), deepLink = deepLinkId ? result.publications.find((item) => item.id === deepLinkId) : null;
      if (deepLink) { setSelected(deepLink); setView(deepLink.kind === "vacante" ? "vacantes" : deepLink.kind === "capacitacion" ? "capacitaciones" : deepLink.kind === "informacion" ? "informacion" : "junta"); history.replaceState(null, "", location.pathname); }
      setData(result);
      localStorage.setItem("docentetuc-data-v1", JSON.stringify(result));
      if (syncIfEmpty && result.publications.length === 0 && !autoSyncStarted.current) {
        autoSyncStarted.current = true;
        window.setTimeout(() => { void syncSourcesRef.current(false); }, 0);
      }
    } catch (error) { const cached = localStorage.getItem("docentetuc-data-v1"); if (cached) { try { const stored = JSON.parse(cached) as AppData; stored.designations ||= []; if (stored.profile) stored.profile.roles ||= []; setData(stored); return; } catch {} } const message = error instanceof Error ? error.message : "No se pudo cargar la información"; setLoadError(message); toast.error(message); }
    finally { if (showLoading) setLoading(false); }
  }, []);

  const syncSources = useCallback(async (notify = true) => {
    setSyncing(true);
    try {
      const response = await fetch("/api/sync", { method: "POST", headers: apiHeaders() });
      const result = await response.json() as { error?: string; skipped?: boolean; count?: number; failures?: number };
      if (!response.ok) throw new Error(result.error || "No se pudo actualizar");
      if (notify) {
        if (result.failures) toast.warning("Algunas fuentes oficiales no respondieron");
        else toast.success(result.skipped ? "Las fuentes ya estaban actualizadas" : `${result.count ?? 0} publicaciones verificadas`);
      }
      await loadRef.current(false, false);
    } catch (error) { const message = error instanceof Error ? error.message : "No se pudo actualizar"; if (notify) toast.error(message); }
    finally { setSyncing(false); }
  }, []);

  useEffect(() => { loadRef.current = load; syncSourcesRef.current = syncSources; }, [load, syncSources]);

  useEffect(() => {
    document.querySelector(".app-background")?.scrollTo(0, 0);
  }, [view]);

  useEffect(() => {
    const preferred = localStorage.getItem("docentetuc-theme") as Theme | null;
    const initial = preferred || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    document.documentElement.dataset.theme = initial; queueMicrotask(() => setTheme(initial));
    queueMicrotask(() => { void loadRef.current(); });
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    const updateNetwork = () => setOffline(!navigator.onLine); queueMicrotask(updateNetwork);
    const install = (event: Event) => { event.preventDefault(); setInstallPrompt(event as InstallPrompt); };
    window.addEventListener("online", updateNetwork); window.addEventListener("offline", updateNetwork); window.addEventListener("beforeinstallprompt", install);
    return () => { window.removeEventListener("online", updateNetwork); window.removeEventListener("offline", updateNetwork); window.removeEventListener("beforeinstallprompt", install); };
  }, []);

  useEffect(() => {
    const onPopState = () => setSelected(null);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!data) return;
    const checkReturn = () => { const id = localStorage.getItem("docentetuc-pending-designation"); if (id) setReturnPublication(data.publications.find((item) => item.id === id) || null); };
    checkReturn(); window.addEventListener("focus", checkReturn); return () => window.removeEventListener("focus", checkReturn);
  }, [data]);

  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const controller = new AbortController();
    void Promise.resolve(context.registerTool({ name: "search_publications", title: "Buscar publicaciones", description: "Busca designaciones, vacantes, capacitaciones, llamados abiertos, padrones, comunicados y novedades visibles en DocenteTuc; cuando hay resultados, abre su módulo con el filtro de búsqueda específico.", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: true }, execute(input: unknown) { const term = typeof input === "object" && input && "query" in input ? String((input as { query: unknown }).query).trim() : ""; const results = (data?.publications || []).filter((item) => normalizeSearchText(publicationSearchText(item)).includes(normalizeSearchText(term))).slice(0, 20); const counts = new Map<string, number>(); for (const item of results) counts.set(item.kind, (counts.get(item.kind) || 0) + 1); const kind = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]; const destination: View | undefined = kind === "vacante" ? "vacantes" : kind === "capacitacion" ? "capacitaciones" : kind === "junta" ? "junta" : kind === "informacion" ? "informacion" : undefined; if (destination) { setView(destination); setFilter("todas"); if (destination === "vacantes") setDesignationQuery(term); else setQuery(term); } return { query: term, resultCount: results.length, openedModule: destination || null, results: results.map(({ id, title, kind: publicationKind, source }) => ({ id, title, kind: publicationKind, source })) }; } }, { signal: controller.signal })).catch(() => undefined);
    void Promise.resolve(context.registerTool({ name: "open_teacher_profile", title: "Abrir perfil docente", description: "Abre el formulario de preferencias del perfil docente.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, untrustedContentHint: false }, execute() { setView("perfil"); return { opened: true }; } }, { signal: controller.signal })).catch(() => undefined);
    return () => controller.abort();
  }, [data]);

  const savedMap = useMemo(() => new Map((data?.saved || []).map((item) => [item.publication_id, item])), [data]);
  const reminderMap = useMemo(() => new Map((data?.reminders || []).map((item) => [item.training_id, item])), [data]);
  const profile = data?.profile;
  const designationAvailability = data ? designationEmptyState({
    filter, profileConfigured: hasDesignationProfilePreferences(profile),
    availableCount: data.publications.filter((item) => item.kind === "vacante").length,
    sourceStatus: data.sync.find((source) => source.source === "SIME")?.sync_status,
  }) : { profileRequired: false, sourceUnavailable: false, sourceVerifiedEmpty: false };
  const matchProfile = profile ? { levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards, roles: profile.roles, department: profile.department, locality: profile.locality, shifts: profile.shifts, characters: profile.characters, circuits: profile.circuits, personalMatchThreshold: profile.personal_match_threshold, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests } : null;
  const publicationForMatch = (publication: Publication) => {
    const trainingMetadata = publication.kind === "capacitacion" ? parseTrainingMetadata(publication.metadata) : null;
    let sourceCircuitRaw = publication.source_circuit_raw || "";
    if (!sourceCircuitRaw && trainingMetadata) sourceCircuitRaw = [trainingMetadata.recipients, trainingMetadata.content].filter(Boolean).join(" ");
    return { kind: publication.kind, title: publication.title, summary: publication.summary, level: publication.level, area: publication.area, role: publication.kind === "vacante" ? designationFacts(publication).role : undefined, junta: publication.junta, location: publication.location, shift: publication.shift, character: publication.character, circuit: publication.circuit, sourceCircuitRaw, circuitInferenceSource: publication.circuit_inference_source, recipients: trainingMetadata?.recipients };
  };
  const matchResult = (publication: Publication) => isGeneralNotice(publication) ? { status: "unconfigured", outcome: "UNKNOWN", score: 0, compatibility: 0, compatibilityScore: 0, confidence: 0, matchConfidence: 0, matched: 0, total: 0, reasons: ["Información general"], criteria: [{ key: "general", label: "Información general", expected: "", matched: false, available: false, outcome: "UNKNOWN", required: false }] } as MatchResult : matchProfile ? profileMatch(publicationForMatch(publication), matchProfile) : { status: "unconfigured", outcome: "UNKNOWN", score: 0, compatibility: 0, compatibilityScore: 0, confidence: 0, matchConfidence: 0, matched: 0, total: 0, reasons: [], criteria: [] } as MatchResult;
  const matches = (publication: Publication) => Boolean(matchProfile && !isGeneralNotice(publication) && isEligibleForPersonalizedHome(publicationForMatch(publication), matchProfile));
  const relevantTraining = (publication: Publication) => publication.kind === "capacitacion" && matchProfile ? isEligibleForPersonalizedHome(publicationForMatch(publication), matchProfile) : false;

  function filteredPublications(search = query) {
    let items = data?.publications || [];
    if (view === "vacantes") items = items.filter((item) => item.kind === "vacante");
    if (view === "capacitaciones") items = items.filter((item) => item.kind === "capacitacion" && (filter === "finalizadas" || enrollmentForUI(item) !== "CERRADA"));
    if (view === "junta") items = items.filter((item) => item.kind === "junta");
    if (view === "informacion") items = items.filter((item) => item.kind === "informacion");
    if (view === "guardados") items = items.filter((item) => savedMap.has(item.id));
    if (filter === "para-mi" && view !== "informacion" && view !== "vacantes") items = items.filter(view === "capacitaciones" ? (item) => relevantTraining(item) && ["ABRE_HOY", "PROXIMAMENTE", "ABIERTA"].includes(enrollmentForUI(item)) : matches);
    if (filter === "abiertas") items = items.filter((item) => view === "capacitaciones" ? enrollmentForUI(item) === "ABIERTA" : item.status === "inscripción abierta");
    if (filter === "proximamente") items = items.filter((item) => view === "capacitaciones" ? ["ABRE_HOY", "PROXIMAMENTE"].includes(enrollmentForUI(item)) : item.status === "próximamente");
    if (filter === "sin-fecha" && view === "capacitaciones") items = items.filter((item) => enrollmentForUI(item) === "SIN_FECHA_CONFIRMADA");
    if (filter === "hoy") items = items.filter((item) => view === "capacitaciones" ? enrollmentForUI(item) === "ABRE_HOY" || (enrollmentForUI(item) === "ABIERTA" && opensToday(item)) : opensToday(item));
    if (filter === "finalizadas" && view !== "vacantes") items = items.filter((item) => ["finalizada", "cerrada", "vencida"].includes(normalize(item.status)));
    if (filter === "guardadas") items = items.filter((item) => savedMap.has(item.id));
    if (filter === "llamados") items = items.filter((item) => normalize(item.category).includes("llamado"));
    if (filter === "padrones") items = items.filter((item) => normalize(item.category).includes("padron"));
    if (filter === "comunicados") items = items.filter((item) => normalize(item.category).includes("comunicado"));
    if (filter === "nuevas") items = items.filter((item) => Date.now() - new Date(`${item.first_seen_at}Z`).getTime() < 7 * 864e5);
    if (filter === "por-vencer") items = items.filter((item) => item.ends_at && new Date(item.ends_at).getTime() > Date.now() && new Date(item.ends_at).getTime() - Date.now() < 3 * 864e5);
    if (view === "vacantes") {
      const historical = (item: Publication) => ["CLOSED", "EXPIRED", "REMOVED_FROM_SOURCE"].includes(publicationLifecycleForUI(item));
      items = filter === "finalizadas" ? items.filter(historical) : items.filter((item) => !historical(item));
      if (filter === "para-mi") items = items.filter((item) => publicationLifecycleForUI(item) === "ACTIVE" && matches(item));
    }
    if (view === "vacantes" && juntaFilter !== "todas") items = items.filter((item) => matchesJunta(item, juntaFilter));
    if (view === "vacantes" && designationCircuit !== "todos") items = items.filter((item) => publicationCircuitMatch(item, designationCircuit));
    if (view === "vacantes" && character !== "todos") items = items.filter((item) => matchesCharacter(item.character, character as (typeof OFFICIAL_CHARACTERS)[number]));
    if (view === "capacitaciones" && character !== "todos") {
      const modality = normalizeSearchText(character);
      items = items.filter((item) => { const value = normalizeSearchText(item.character); return modality === "virtual" ? /virtual|online|distancia|autoasistida/.test(value) : modality === "presencial" ? /presencial/.test(value) && !/semipresencial|mixta/.test(value) : /semipresencial|mixta|hibrida/.test(value); });
    }
    if (view === "capacitaciones" && trainingSource.startsWith("platform:")) items = items.filter((item) => trainingPlatform(item.source) === trainingSource.slice("platform:".length));
    else if (view === "capacitaciones" && trainingSource !== "todas") items = items.filter((item) => item.source === trainingSource);
    if (view === "capacitaciones" && trainingCompatibility !== "todas") items = items.filter((item) => { const score = matchResult(item).score, confidence = matchResult(item).confidence; if (trainingCompatibility === "high") return score >= 85 && confidence >= 70; if (trainingCompatibility === "good") return score >= 70 && score < 85 && confidence >= 70; if (trainingCompatibility === "partial") return score >= 50 && score < 70 && confidence >= 50; if (trainingCompatibility === "low") return score < 50 && confidence >= 50; return confidence < 50; });
    if (view === "capacitaciones" && trainingDate) items = items.filter((item) => {
      const opensAt = parseTrainingMetadata(item.metadata)?.registrationOpensAt;
      if (!opensAt) return false;
      const difference = new Date(opensAt).getTime() - Date.now();
      return difference >= 0 && difference <= (trainingDate === "week" ? 7 : 30) * 86_400_000;
    });
    if (view === "capacitaciones" && trainingSource === "platform:fdci" && trainingCircuit !== "todos") items = items.filter((item) => publicationCircuitMatch(item, trainingCircuit));
    const activeSearch = view === "vacantes" ? designationQuery : search;
    if (activeSearch.trim()) { const term = normalizeSearchText(activeSearch); items = items.filter((item) => normalizeSearchText(publicationSearchText(item)).includes(term)); }
    if (view === "capacitaciones") items = [...items].sort((a, b) => {
      const opening = (item: Publication) => Date.parse(parseTrainingMetadata(item.metadata)?.registrationOpensAt || "") || Number.MAX_SAFE_INTEGER;
      const rank = (item: Publication) => ({ ABRE_HOY: 0, PROXIMAMENTE: 1, ABIERTA: 2, SIN_FECHA_CONFIRMADA: 3, CERRADA: 4 })[enrollmentForUI(item)];
      if (trainingSort === "opening") return opening(a) - opening(b);
      if (trainingSort === "open") return Number(enrollmentForUI(b) === "ABIERTA") - Number(enrollmentForUI(a) === "ABIERTA") || opening(a) - opening(b);
      if (trainingSort === "recent") return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      if (trainingSource === "platform:fdci" && ["ABRE_HOY", "PROXIMAMENTE"].includes(enrollmentForUI(a)) && ["ABRE_HOY", "PROXIMAMENTE"].includes(enrollmentForUI(b))) return opening(a) - opening(b);
      return rank(a) - rank(b) || Number(relevantTraining(b)) - Number(relevantTraining(a)) || matchResult(b).score - matchResult(a).score || opening(a) - opening(b);
    });
    return items;
  }

  const mutateSaved = async (action: "save" | "agenda" | "follow", publication: Publication, enabled: boolean, agenda?: { at?: string; notes?: string; reminderAt?: string }) => {
    setData((current) => {
      if (!current) return current;
      const existing = current.saved.find((item) => item.publication_id === publication.id);
      let saved = current.saved.filter((item) => item.publication_id !== publication.id);
      if (action !== "save" || enabled) saved = [...saved, { publication_id: publication.id, in_agenda: action === "agenda" ? enabled : existing?.in_agenda || false, followed: action === "follow" ? enabled : existing?.followed || false, agenda_at: action === "agenda" ? (agenda?.at ? new Date(agenda.at).toISOString() : null) : existing?.agenda_at, agenda_notes: action === "agenda" ? agenda?.notes || "" : existing?.agenda_notes, agenda_reminder_at: action === "agenda" ? agenda?.reminderAt || null : existing?.agenda_reminder_at, agenda_reminder_notified: false, saved_at: existing?.saved_at || new Date().toISOString() }];
      return { ...current, saved };
    });
    const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action, publicationId: publication.id, enabled, agendaAt: agenda?.at ? new Date(agenda.at).toISOString() : undefined, agendaNotes: agenda?.notes, agendaReminderAt: agenda?.reminderAt }) });
    if (!response.ok) { toast.error("No se pudo guardar el cambio"); await load(false); } else toast.success(action === "save" ? (enabled ? "Guardado" : "Quitado de guardados") : action === "agenda" ? "Agenda actualizada" : "Seguimiento actualizado");
  };

  const saveReminder = async () => {
    if (!reminderPublication) return;
    const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "set_training_reminder", publicationId: reminderPublication.id, advanceMinutes: reminderAdvances }) });
    const result = await response.json() as { error?: string };
    if (!response.ok) return toast.error(result.error || "No se pudo crear el recordatorio");
    toast.success("Recordatorio activado"); setReminderPublication(null); await load(false);
  };

  const install = async () => { if (!installPrompt) return; await installPrompt.prompt(); const choice = await installPrompt.userChoice; if (choice.outcome === "accepted") setInstallPrompt(null); };
  const toggleTheme = () => setTheme((current) => { const next = current === "dark" ? "light" : "dark"; localStorage.setItem("docentetuc-theme", next); document.documentElement.dataset.theme = next; return next; });
  const openAI = (context: AIContext) => { setAIContext(context); setSelected(null); setAIMode("minimized"); };
  const runAIAction = async (action: AIAssistantAction, context: AIContext) => {
    const publication = data?.publications.find((item) => item.id === context.id);
    if (!publication) throw new Error("Publicación no encontrada");
    if (action === "remind") { if (publication.kind === "vacante") setTrackingPublication(publication); else setReminderPublication(publication); return; }
    await mutateSaved(action, publication, true);
  };
  const alertPublicationMap = new Map((data?.publications || []).map((item) => [item.id, item]));
  const followedPublicationIds = new Set([...(data?.saved || []).map((item) => item.publication_id), ...(data?.reminders || []).map((item) => item.publication_id), ...(data?.designations || []).map((item) => item.publication_id)]);
  const unread = new Set((data?.notifications || []).filter((notice) => !Boolean(notice.read)).filter((notice) => {
    const item = alertPublicationMap.get(notice.publication_id);
    if (!item) return false;
    const lifecycle = publicationLifecycleForUI(item);
    if (lifecycle === "REMOVED_FROM_SOURCE") return false;
    return followedPublicationIds.has(item.id) || isGeneralNotice(item) || (["ACTIVE", "UPCOMING"].includes(lifecycle) && Boolean(matchProfile && isEligibleForPersonalizedHome(publicationForMatch(item), matchProfile)));
  }).map((notice) => notice.publication_id)).size;
  const items = view === "inicio" ? [] : filteredPublications();
  const hasTrainingTerritoryData = (data?.publications || []).some((item) => item.kind === "capacitacion" && trainingPlatform(item.source) === "fdci" && item.circuit && item.circuit !== "UNKNOWN");
  const designationMap = new Map((data?.designations || []).map((item) => [item.publication_id, item]));
  const roleOptions = [...new Set((data?.publications || []).filter((item) => item.kind === "vacante").map((item) => designationFacts(item).role).filter(Boolean))].slice(0, 80);
  const navigateToView = (target: View, term = "") => {
    if (target === "comunidad") { router.push("/comunidad"); return; }
    setView(target); setQuery(term); setDesignationQuery(""); setFilter(target === "informacion" || target === "junta" ? "todas" : "para-mi");
  };
  const openDesignationOfficial = (item: Publication) => { localStorage.setItem("docentetuc-pending-designation", item.id); window.open(item.official_url, "_blank", "noopener,noreferrer"); };
  return (
    <SidebarProvider defaultOpen className="dt-app-shell" style={{ "--sidebar-width": "17rem" } as CSSProperties}>
      <Sidebar className="border-r border-white/10 text-white backdrop-blur-xl" collapsible="offcanvas">
        <SidebarHeader className="p-5"><button onClick={() => setView("inicio")} className="flex items-center gap-3 text-left"><Image src="/icon-192.png" alt="" width={48} height={48} unoptimized className="size-12 rounded-2xl shadow-sm" /><span><span className="block text-xl font-black">DocenteTuc</span><span className="block text-xs text-white/55">Información docente</span></span></button></SidebarHeader>
        <SidebarContent className="px-3"><AppSidebarNavigation view={view} onNavigate={(id) => navigateToView(id)} /></SidebarContent>
        <SidebarFooter className="p-5"><p className="text-xs leading-relaxed text-white/45">Herramienta independiente. La fuente oficial prevalece siempre.</p></SidebarFooter>
      </Sidebar>

      <SidebarInset className="min-w-0 bg-[#f4f7f5] text-[var(--foreground)]">
        <AppBackground>
        <AppHeader className="mobile-topbar min-h-20 gap-3 border-[#dce8e1] px-4 md:px-8">
          <SidebarTrigger className="size-11 rounded-xl bg-white md:hidden"><Menu /></SidebarTrigger>
          {view === "inicio" ? <div className="flex flex-1 items-center gap-3"><Image src="/icon-192.png" alt="" width={40} height={40} unoptimized className="size-10 rounded-xl md:hidden" /><span className="font-black text-[#062b55] md:hidden">DocenteTuc</span></div> : !["vacantes", "perfil", "cuentas"].includes(view) ? <div className="relative max-w-2xl flex-1"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[#52708c]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label={view === "capacitaciones" ? "Buscar capacitaciones" : "Buscar en DocenteTuc"} placeholder={view === "capacitaciones" ? "Buscar capacitaciones..." : "¿Qué estás buscando?"} className="h-12 rounded-2xl border-[#c8e1f1] bg-white pl-11 shadow-sm" />{query && <button aria-label="Limpiar búsqueda" onClick={() => setQuery("")} className="absolute right-3 top-1/2 -translate-y-1/2 p-2"><X className="size-4" /></button>}</div> : <div className="flex-1" />}
          {installPrompt && <Button onClick={install} variant="outline" className="hidden h-11 rounded-xl border-[#bdd0c6] bg-white sm:flex"><Download className="size-4" />Instalar</Button>}
          {view === "inicio" && accountPhoto.authenticated && <Button onClick={() => setView("cuentas")} size="icon" variant="outline" aria-label="Ir a Cuentas y accesos" className="size-11 shrink-0 rounded-full border-[#dce8e1] bg-white p-0"><GoogleAccountPhoto src={accountPhoto.image} /></Button>}
          <Button onClick={toggleTheme} size="icon" variant="outline" className="size-11 rounded-xl border-[#dce8e1] bg-white" aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo oscuro"}>{theme === "dark" ? <Sun className="size-5" /> : <Moon className="size-5" />}</Button>
          <Button onClick={() => { setView("alertas"); setQuery(""); }} size="icon" variant="outline" className="relative size-11 rounded-xl border-[#dce8e1] bg-white"><Bell className="size-5" />{unread > 0 && <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-[#ee6a4b] px-1 text-[10px] font-bold text-white">{unread > 9 ? "9+" : unread}</span>}<span className="sr-only">Alertas relevantes no leídas</span></Button>
        </AppHeader>

        {offline && <div className="flex items-center justify-center gap-2 bg-[#fff3dd] px-4 py-2 text-sm font-semibold text-[#7d541b]"><WifiOff className="size-4" />Sin conexión. Podés consultar la última información cargada.</div>}

        <div className="mobile-content mx-auto w-full max-w-7xl p-4 md:p-8">
      {view === "inicio" ? <Dashboard data={data} profile={profile} savedMap={savedMap} reminderMap={reminderMap} matches={matches} matchResult={matchResult} onOpen={openPublication} onRemind={setReminderPublication} onView={navigateToView} loading={loading} error={loadError} />
        : view === "perfil" ? <>
          <ProfileForm key={profile?.updated_at || "profile"} profile={profile} roleOptions={roleOptions} onSaved={() => void load(false)} />
          <PublicProfileSection profile={data?.publicProfile ?? null} headers={() => apiHeaders(true)} onSaved={() => void load(false)} />
          {process.env.NODE_ENV === "development" && <SystemStatus sources={data?.sync || []} />}
        </>
        : view === "cuentas" ? <>
          <section className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4 sm:p-5" aria-labelledby="accounts-access-title">
            <div className="mb-4">
              <h2 id="accounts-access-title" className="text-xl font-black text-[var(--text-primary)]">Mis cuentas y accesos</h2>
              <p className="mt-1 text-sm text-[var(--text-secondary)]">Google autentica tu cuenta de DocenteTuc. Los accesos externos usan sus propias credenciales y no se comparten con DocenteTuc.</p>
            </div>
            <AccountSignInSection headers={apiHeaders} onLinked={() => void load(false)} onSignedOut={() => setData(null)} />
          </section>
          <PlatformAccessSection />
          <DataDeletionSection profile={profile ?? null} />
        </>
        : view === "alertas" ? <><PushSettings key={`push:${profile?.updated_at || "profile"}`} profile={profile ?? null} /><Alerts data={data} onOpen={openPublication} onRead={async (id) => { await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "read_notification", id }) }); await load(false); }} /></>
          : view === "agenda" ? <Agenda publications={data?.publications || []} savedMap={savedMap} manualEvents={data?.manualEvents || []} onOpen={openPublication} onNewEvent={(date) => { setManualEventDate(date || ""); setManualEvent("new"); }} onEditEvent={setManualEvent} />
            : view === "informacion" ? <InformationHub items={items} query={query} onQuery={setQuery} savedMap={savedMap} onOpen={openPublication} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} onAskAI={() => openAI({ type: "informacion", title: viewTitles.informacion[0] })} /> : <>
            <PageHeader view={view} count={items.length} filter={filter} query={query} syncing={syncing} onSync={() => void syncSources()} onAskAI={() => openAI({ type: view, title: viewTitles[view][0] })} />
            <Filters filter={filter} setFilter={setFilter} junta={juntaFilter} setJunta={setJuntaFilter} character={character} setCharacter={setCharacter} query={designationQuery} setQuery={setDesignationQuery} kind={view} date={trainingDate} setDate={setTrainingDate} source={trainingSource} setSource={setTrainingSource} compatibility={trainingCompatibility} setCompatibility={setTrainingCompatibility} sort={trainingSort} setSort={setTrainingSort} hasTrainingTerritoryData={hasTrainingTerritoryData} circuit={view === "vacantes" ? designationCircuit : trainingCircuit} setCircuit={view === "vacantes" ? setDesignationCircuit : setTrainingCircuit} />
             {view === "vacantes" && !loading && items.length === 0 && (designationAvailability.profileRequired || designationAvailability.sourceUnavailable || designationAvailability.sourceVerifiedEmpty)
               ? <DesignationEmptyState {...designationAvailability} onCompleteProfile={() => setView("perfil")} />
               : <PublicationList items={items} loading={loading} savedMap={savedMap} reminderMap={reminderMap} matchResult={matchResult} onOpen={openPublication} onRemind={setReminderPublication} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} emptyContext={view === "capacitaciones" ? trainingSource === "platform:fdci" ? "FDCI" : trainingSource === "platform:infod" ? "INFoD" : trainingSource === "platform:cenet" ? "CeNET / INET" : "las plataformas seleccionadas" : "esta búsqueda"} onClearFilters={() => { setTrainingSource("todas"); setTrainingDate(""); setTrainingCircuit("todos"); setDesignationCircuit("todos"); setTrainingCompatibility("todas"); setJuntaFilter("todas"); setCharacter("todos"); setFilter(view === "capacitaciones" ? "para-mi" : "todas"); setDesignationQuery(""); setQuery(""); }} />}
          </>}
        </div>

        {aiMode === "closed" && !reminderPublication && <AIWidget onOpen={() => openAI({ type: view === "cuentas" ? "perfil" : view, title: viewTitles[view][0] })} />}
        <BottomNavigation items={navigation.filter(([id]) => ["inicio", "vacantes", "comunidad", "agenda", "perfil"].includes(id)).map(([id, label, icon]) => ({ id, label: id === "vacantes" ? "Designaciones" : id === "perfil" ? "Perfil" : label, icon }))} active={view} onNavigate={(id) => navigateToView(id as View)} />
        </AppBackground>
      </SidebarInset>

      <PublicationSheet publication={selected} saved={selected ? savedMap.get(selected.id) : undefined} tracking={selected ? designationMap.get(selected.id) : undefined} match={selected ? matchResult(selected) : null} onClose={closePublication} onAskAI={(item) => openAI({ type: item.kind === "vacante" ? "designaciones" : item.kind, id: item.id, title: item.title })} onSave={(item, enabled) => void mutateSaved("save", item, enabled)} onAgenda={(item, enabled) => void mutateSaved("agenda", item, enabled)} onSchedule={(item) => { const stored = savedMap.get(item.id); setAgendaPublication(item); setAgendaAt(stored?.agenda_at ? new Date(stored.agenda_at).toISOString().slice(0, 16) : ""); setAgendaNotes(stored?.agenda_notes || ""); }} onFollow={(item, enabled) => void mutateSaved("follow", item, enabled)} onExternal={openDesignationOfficial} onEditDesignation={setTrackingPublication} />
      <InformationAgendaAction publication={selected?.kind === "informacion" ? selected : null} saved={selected ? savedMap.get(selected.id) : undefined} onSchedule={(item) => { const stored = savedMap.get(item.id); setAgendaPublication(item); setAgendaAt(stored?.agenda_at ? new Date(stored.agenda_at).toISOString().slice(0, 16) : ""); setAgendaNotes(stored?.agenda_notes || ""); }} onRemove={(item) => void mutateSaved("agenda", item, false)} />
      <ReminderDialog publication={reminderPublication} advances={reminderAdvances} onAdvances={setReminderAdvances} onClose={() => setReminderPublication(null)} onSave={() => void saveReminder()} />
      <AgendaDialog publication={agendaPublication} at={agendaAt} notes={agendaNotes} reminder={agendaReminder} onAt={setAgendaAt} onNotes={setAgendaNotes} onReminder={setAgendaReminder} onClose={() => setAgendaPublication(null)} onSave={() => { if (!agendaPublication || !agendaAt) return; const minutes = agendaReminder === "one_day" ? 1440 : agendaReminder === "one_hour" ? 60 : 0, reminderAt = agendaReminder === "none" ? undefined : new Date(new Date(agendaAt).getTime() - minutes * 60_000).toISOString(); void mutateSaved("agenda", agendaPublication, true, { at: agendaAt, notes: agendaNotes, reminderAt }).then(() => setAgendaPublication(null)); }} />
      {manualEvent && <ManualEventDialog key={manualEvent === "new" ? `new:${manualEventDate}` : manualEvent.id} event={manualEvent === "new" ? null : manualEvent} initialDate={manualEventDate} onClose={() => setManualEvent(null)} onSaved={async () => { setManualEvent(null); await load(false); }} />}
      <DesignationReturnDialog publication={returnPublication} onNo={() => { localStorage.removeItem("docentetuc-pending-designation"); setReturnPublication(null); }} onYes={() => { if (returnPublication) setTrackingPublication(returnPublication); localStorage.removeItem("docentetuc-pending-designation"); setReturnPublication(null); }} />
      <DesignationForm publication={trackingPublication} existing={trackingPublication ? designationMap.get(trackingPublication.id) : undefined} onClose={() => setTrackingPublication(null)} onSaved={async () => { setTrackingPublication(null); await load(false); }} />
      <DocenteTucAIChatPanel mode={aiMode} onClose={() => setAIMode("closed")} onMinimize={() => setAIMode("minimized")} onExpand={() => setAIMode("expanded")} context={aiContext} profileAvailable={Boolean(profile)} headers={() => apiHeaders(true)} onAction={runAIAction} />
      <Toaster richColors position="top-center" />
    </SidebarProvider>
  );
}

const usefulCategoryIcons: Record<string, string> = { "Sueldo y haberes": "💰", "Juntas": "🏛️", "Trámites": "📄", "Personal docente": "👤", "Títulos y certificados": "🎓", "Capacitación y FDCI": "📚", "CIIDEPT": "🏢", "Licencias y salud laboral": "🩺", "Jubilaciones": "👴", "Expedientes": "📋", "Gestión escolar": "🏫", "Normativa y documentación": "⚖️" };

function InformationHub({ items, query, onQuery, savedMap, onOpen, onSave, onAskAI }: { items: Publication[]; query: string; onQuery: (value: string) => void; savedMap: Map<string, Saved>; onOpen: (item: Publication) => void; onSave: (item: Publication, enabled: boolean) => void; onAskAI: () => void }) {
  const allCategories = [...new Set(items.map((item) => item.category))], [category, setCategory] = useState<string | null>(null);
  const visible = (category ? items.filter((item) => item.category === category) : query ? items : []).filter((item) => !query || normalize(publicationSearchText(item)).includes(normalize(query)));
  const favorites = items.filter((item) => savedMap.has(item.id));
  const openCategory = (name: string) => { setCategory(name); history.pushState({ usefulCategory: name }, "", `#util-${encodeURIComponent(name)}`); };
  useEffect(() => { const onPopState = () => setCategory((history.state?.usefulCategory as string | undefined) || null); window.addEventListener("popstate", onPopState); return () => window.removeEventListener("popstate", onPopState); }, []);
  const usefulCard = (item: Publication) => { const metadata = usefulMetadata(item.metadata); return <article key={item.id} className="rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-3 backdrop-blur-xl"><div className="flex items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-lg">{usefulCategoryIcons[item.category] || "ℹ️"}</span><button onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left"><span className="text-[10px] font-black uppercase tracking-wide text-[var(--accent-text)]">{metadata?.recordType === "procedure" ? "TRÁMITE" : metadata?.recordType === "system" ? "SISTEMA" : "ORGANISMO"}</span><h2 className="font-black leading-tight text-[var(--text-primary)]">{item.title}</h2><p className="mt-0.5 line-clamp-2 text-sm text-[var(--text-muted)]">{item.summary}</p></button><button aria-label={savedMap.has(item.id) ? "Quitar de contactos" : "Guardar contacto"} onClick={() => onSave(item, !savedMap.has(item.id))} className="p-2 text-[var(--accent-text)]"><Star className={`size-5 ${savedMap.has(item.id) ? "fill-[#f4b942] text-[#9a6810]" : ""}`} /></button><ChevronRight className="size-4 shrink-0 text-[var(--text-muted)]" /></div></article>; };
  return <section className="space-y-4 pb-16 md:pb-0">
    <VisualSectionBanner kind="informacion" title={category || "Información útil"} description="Organismos, trámites y servicios docentes en un solo lugar." />
    <header className="info-search-header">{category && <button aria-label="Volver a Información útil" onClick={() => { setCategory(null); history.back(); }} className="grid size-10 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-text)]"><ChevronRight className="size-5 rotate-180" /></button>}<div className="relative min-w-0 flex-1"><Search className="absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--text-muted)]" /><Input value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Buscar: recibo, junta, certificado..." className="h-11 rounded-xl bg-[var(--input-background)] pl-11" /></div></header>
    <a href="/privacidad" className="flex min-h-11 items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-4 text-sm font-bold text-[var(--accent-text)]">Política de Privacidad de DocenteTuc <ChevronRight className="size-4" aria-hidden="true" /></a>
    {!category && !query && <div className="space-y-1.5">{allCategories.map((name) => <button key={name} onClick={() => openCategory(name)} className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-3 text-left text-sm font-black text-[var(--text-primary)]"><span className="text-lg">{usefulCategoryIcons[name] || "ℹ️"}</span><span className="flex-1">{name}</span><ChevronRight className="size-4 text-[var(--text-muted)]" /></button>)}</div>}
    {!category && !query && favorites.length > 0 && <div><h2 className="mb-1.5 text-xs font-black uppercase tracking-wide text-[var(--accent-text)]">Mis contactos</h2><div className="grid gap-1.5">{favorites.map((item) => <button key={item.id} onClick={() => onOpen(item)} className="flex min-h-11 items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] px-3 text-left"><Star className="size-4 fill-[#f4b942] text-[#9a6810]" /><span className="truncate font-bold text-[var(--text-primary)]">{item.title}</span><ChevronRight className="ml-auto size-4" /></button>)}</div></div>}
    {(category || query) && <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-black uppercase tracking-wide text-[var(--accent-text)]">{query ? "Resultados" : category}</p><p className="text-sm text-[var(--text-muted)]">{visible.length} fichas oficiales</p></div><Button variant="outline" onClick={onAskAI} className="rounded-xl bg-[var(--surface-primary)]"><Sparkles className="size-4" />Preguntar</Button></div>}
    {(category || query) && <div className="grid gap-2 md:grid-cols-2">{visible.map(usefulCard)}</div>}
    {(category || query) && !visible.length && <Empty title="No encontramos información" text="Probá con sueldo, legajo, jubilación, certificado, título, licencia o expediente." />}
  </section>;
}

type DashboardProps = { data: AppData | null; profile?: Profile; savedMap: Map<string, Saved>; reminderMap: Map<string, TrainingReminder>; matches: (item: Publication) => boolean; matchResult: (item: Publication) => MatchResult; isEligible?: (item: Publication) => boolean; onOpen: (item: Publication) => void; onRemind: (item: Publication) => void; onView: (view: View, query?: string) => void; loading: boolean; error: string };

const homeShortcuts: { label: string; caption: string; icon: typeof Home; view: View; image: string; query?: string }[] = [
  { label: "Designaciones", caption: "Oportunidades en SIME", icon: BriefcaseBusiness, view: "vacantes", image: "designaciones" },
  { label: "Capacitaciones", caption: "Cursos y aperturas", icon: GraduationCap, view: "capacitaciones", image: "capacitaciones" },
  { label: "Padrones", caption: "Listados y llamados", icon: BookOpen, view: "junta", image: "padrones", query: "padron" },
  { label: "Agenda", caption: "Tus fechas", icon: CalendarDays, view: "agenda", image: "agenda" },
  { label: "Novedades", caption: "Comunicados recientes", icon: Bell, view: "junta", image: "novedades", query: "novedad" },
  { label: "Información útil", caption: "Trámites y organismos", icon: Building2, view: "informacion", image: "informacion" },
];

function SystemStatus({ sources }: { sources: SyncStatus[] }) {
  return <details className="mt-5 rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 backdrop-blur-xl">
    <summary className="min-h-10 cursor-pointer font-bold text-[var(--text-secondary)]">Diagnóstico avanzado · Estado del sistema</summary>
    <p className="mt-2 text-sm text-[var(--text-muted)]">Información técnica para soporte. No afecta el uso normal de la aplicación.</p>
    <div className="mt-3 space-y-2">{[...sources].sort((a, b) => a.source.localeCompare(b.source, "es")).map((source) => <details key={source.source} className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)] p-3">
      <summary className="cursor-pointer text-sm font-bold text-[var(--text-primary)]">{source.source}</summary>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 text-xs">
        <dt className="text-[var(--text-muted)]">Estado</dt><dd className="text-right font-semibold text-[var(--text-secondary)]">{source.sync_status || "Sin dato"}</dd>
        <dt className="text-[var(--text-muted)]">Último intento</dt><dd className="text-right font-semibold text-[var(--text-secondary)]">{source.last_attempt_at ? dateLabel(source.last_attempt_at, true) : "Sin dato"}</dd>
        <dt className="text-[var(--text-muted)]">Último éxito</dt><dd className="text-right font-semibold text-[var(--text-secondary)]">{source.last_successful_sync_at ? dateLabel(source.last_successful_sync_at, true) : "Sin dato"}</dd>
        <dt className="text-[var(--text-muted)]">Último cambio de contenido</dt><dd className="text-right font-semibold text-[var(--text-secondary)]">{source.last_content_change_at ? dateLabel(source.last_content_change_at, true) : "Sin dato"}</dd>
        <dt className="text-[var(--text-muted)]">Registros conocidos</dt><dd className="text-right font-semibold text-[var(--text-secondary)]">{source.item_count ?? "Sin dato"}</dd>
      </dl>
      {(source.error_code || source.error_message || source.error) && <p className="mt-3 break-words rounded-lg border border-[var(--border)] p-2 text-xs text-[var(--text-muted)]">{[source.error_code, source.error_message || source.error].filter(Boolean).join(" · ")}</p>}
    </details>)}</div>
  </details>;
}

function Dashboard({ data, profile, savedMap, reminderMap, matches, matchResult, isEligible, onOpen, onRemind, onView, loading, error }: DashboardProps) {
  const now = new Date();
  const publications = data?.publications || [];
  const sync = data?.sync || [];
  const publicationMap = new Map(publications.map((item) => [item.id, item]));
  const currentForHome = (item: Publication) => canRecommendCurrentPublication({ lifecycle: publicationLifecycleForUI(item, now), health: healthForPublication(item, sync), now });
  const eventDate = (item: Publication) => savedMap.get(item.id)?.agenda_at || parseTrainingMetadata(item.metadata)?.registrationOpensAt || item.ends_at || item.starts_at;
  const relevant = isEligible || matches;
  const agenda = publications.filter((item) => {
    const date = safeDate(eventDate(item));
    return Boolean(savedMap.get(item.id)?.in_agenda) && Boolean(date && date.getTime() >= now.getTime());
  }).sort((a, b) => safeDate(eventDate(a))!.getTime() - safeDate(eventDate(b))!.getTime());
  const manualEvents = data?.manualEvents || [];
  const upcomingManualAgenda = manualEvents.flatMap((item) => { const startsAt = safeDate(item.starts_at); return startsAt && startsAt.getTime() >= now.getTime() ? [{ title: item.title, startsAt: item.starts_at }] : []; });
  const nextAgendaEntry = [...agenda.map((item) => ({ title: item.title, startsAt: eventDate(item) || "" })), ...upcomingManualAgenda].filter((item) => Boolean(safeDate(item.startsAt))).sort((a, b) => (safeDate(a.startsAt)?.getTime() ?? Number.MAX_SAFE_INTEGER) - (safeDate(b.startsAt)?.getTime() ?? Number.MAX_SAFE_INTEGER))[0];
  const todayEvents = agenda.filter((item) => calendarDayDistance(eventDate(item), now) === 0).length + manualEvents.filter((item) => calendarDayDistance(item.starts_at, now) === 0).length;
  const vacancies = publications.filter((item) => item.kind === "vacante" && publicationLifecycleForUI(item, now) === "ACTIVE" && currentForHome(item) && relevant(item)).sort((a, b) => matchResult(b).score - matchResult(a).score);
  const candidate = (item: Publication) => { const metadata = parseTrainingMetadata(item.metadata), result = matchResult(item); return { kind: item.kind === "informacion" ? "junta" as const : item.kind, registrationOpensAt: metadata?.registrationOpensAt, registrationClosesAt: metadata?.registrationClosesAt, eventAt: eventDate(item), matched: matches(item), inAgenda: Boolean(savedMap.get(item.id)?.in_agenda), updatedAt: item.updated_at, matchScore: result.status === "unconfigured" ? undefined : result.score }; };
  const compare = (a: Publication, b: Publication) => compareHomePriority(candidate(a), candidate(b), now);
  const profileReady = Boolean(profile && (profile.levels.length || profile.boards.length) && (profile.areas.length || profile.subjects.length || profile.roles.length || profile.circuits.length || profile.training_interests.length));
  const upcoming = publications.filter((item) => {
    const metadata = parseTrainingMetadata(item.metadata);
    return item.kind === "capacitacion" && ["confirmed", "course_confirmed"].includes(String(metadata?.dateStatus || "").toLowerCase())
      && currentForHome(item) && ["today", "tomorrow", "two-three", "four-seven", "eight-fourteen", "open"].includes(registrationState(metadata?.registrationOpensAt, metadata?.registrationClosesAt, now));
  }).sort((a, b) => {
    const aOpen = Date.parse(parseTrainingMetadata(a.metadata)?.registrationOpensAt || ""), bOpen = Date.parse(parseTrainingMetadata(b.metadata)?.registrationOpensAt || "");
    const aFuture = Number.isFinite(aOpen) && aOpen > now.getTime(), bFuture = Number.isFinite(bOpen) && bOpen > now.getTime();
    if (aFuture !== bFuture) return aFuture ? -1 : 1;
    if (aFuture && bFuture && a.source === "Capacitación Docente" && b.source === "Capacitación Docente") return aOpen - bOpen;
    return Number(relevant(b)) - Number(relevant(a)) || compare(a, b);
  });
  const eligibleUpcoming = upcoming.filter((item) => relevant(item));
  const nextTraining = profileReady ? eligibleUpcoming[0] : undefined, nextMetadata = nextTraining ? parseTrainingMetadata(nextTraining.metadata) : null, nextMatch = nextTraining ? matchResult(nextTraining) : null;
  const forYou = publications.filter((item) => currentForHome(item) && (item.kind !== "vacante" || publicationLifecycleForUI(item, now) === "ACTIVE") && relevant(item) && !isGeneralNotice(item) && item.id !== nextTraining?.id && item.id !== vacancies[0]?.id).sort(compare).slice(0, 2);
  const unreadByPublication = new Map<string, Notice>();
  for (const notice of data?.notifications || []) {
    if (Boolean(notice.read) || unreadByPublication.has(notice.publication_id)) continue;
    const item = publicationMap.get(notice.publication_id);
    if (item && publicationLifecycleForUI(item, now) !== "REMOVED_FROM_SOURCE" && (relevant(item) || isGeneralNotice(item) || savedMap.has(item.id))) unreadByPublication.set(notice.publication_id, notice);
  }
  const unread = [...unreadByPublication.values()];
  const alreadySurfaced = new Set([nextTraining?.id, ...forYou.map((item) => item.id), vacancies[0]?.id].filter(Boolean));
  const importantNotice = unread.map((notice) => ({ notice, publication: publicationMap.get(notice.publication_id) })).find(({ publication }) => publication && (isGeneralNotice(publication) || (relevant(publication) && !alreadySurfaced.has(publication.id))));
  const primaryHomeIds = new Set([nextTraining?.id, ...forYou.map((item) => item.id), vacancies[0]?.id, importantNotice?.publication?.id].filter(Boolean));
  const latest = [...publications].filter((item) => currentForHome(item) && !primaryHomeIds.has(item.id) && (relevant(item) || isGeneralNotice(item))).sort((a, b) => new Date(b.last_changed_at || b.updated_at).getTime() - new Date(a.last_changed_at || a.updated_at).getTime()).slice(0, 3);
  const profileNeedsDetail = !profileReady || !publications.some((item) => matchResult(item).confidence >= 70);
  const priorityLabel = (item: Publication) => {
    const itemCandidate = candidate(item), rank = homePriority(itemCandidate, now), days = calendarDayDistance(itemCandidate.registrationOpensAt, now);
    return rank === 0 ? "🔥 ABRE HOY" : rank === 1 ? "🔥 ABRE MAÑANA" : rank <= 4 ? `🔥 ABRE EN ${days} DÍAS` : rank === 5 ? "🟢 INSCRIPCIÓN ABIERTA" : rank === 6 ? "🎯 DESIGNACIÓN PARA VOS" : rank === 7 ? "📅 PRÓXIMO EN AGENDA" : "NOVEDAD PARA VOS";
  };

  if (error && !data) return <section className="grid min-h-[65vh] place-items-center"><div className="max-w-lg rounded-3xl border border-[#ead6b8] bg-white p-8 text-center shadow-sm"><WifiOff className="mx-auto size-10 text-[#b57828]" /><h1 className="mt-4 text-2xl font-black">No pudimos cargar tu panel</h1><p className="mt-2 text-[#61766f]">Revisá tu conexión y volvé a intentarlo.</p><Button onClick={() => window.location.reload()} className="mt-6 h-11 rounded-xl bg-[#17362d] px-6 text-white"><RefreshCw className="size-4" />Reintentar</Button></div></section>;

  return <div className="daily-home">
    <header className="home-hero">
      <div className="home-hero-top"><h1 className="sr-only">DocenteTuc · Tu información educativa en un solo lugar</h1></div>
      <div className="home-hero-copy"><HomeBannerContext name={profile?.name} /></div>
    </header>
    <section className="home-section home-for-you"><div className="home-section-title"><div><p>IMPORTANTE PARA VOS</p><h2>Oportunidades a tu medida</h2></div><button onClick={() => onView("capacitaciones")}>Ver oportunidades <ChevronRight className="size-4" /></button></div>
      {loading ? <HomeSkeleton /> : <>
        {nextTraining && nextMetadata && <div className="home-next-registration"><button className="home-next-main" onClick={() => onOpen(nextTraining)}><span className="home-next-eyebrow">{priorityLabel(nextTraining)}</span>{nextMetadata.dateStatus === "tentative" && <span className="home-next-tentative">PREINSCRIPCIÓN PREVISTA · FECHA TENTATIVA</span>}<strong>{nextTraining.title}</strong><small>{nextTraining.source}</small><span className="home-next-dates">📅 Abre: {dateLabel(nextMetadata.registrationOpensAt || null, Boolean(nextMetadata.registrationHasTime))}{nextMetadata.registrationClosesAt ? ` · Cierra: ${dateLabel(nextMetadata.registrationClosesAt, true)}` : ""}</span>{nextMatch?.status !== "unconfigured" && nextMatch?.score != null && <span className="home-match">{nextMatch.score}% compatible con tu perfil</span>}</button><div className="home-next-actions"><button onClick={() => onOpen(nextTraining)}>{registrationState(nextMetadata.registrationOpensAt, nextMetadata.registrationClosesAt, now) === "open" ? "Inscribirme" : "Ver curso"}</button><button onClick={() => onRemind(nextTraining)}><Bell className="size-4" />{reminderMap.has(trainingReminderKey(nextMetadata)) ? "Avisos activos" : "Avisarme"}</button></div>{upcoming.length > 1 && <button className="home-next-more" onClick={() => onView("capacitaciones")}>{upcoming.length - 1} {upcoming.length === 2 ? "inscripción más próxima" : "inscripciones más próximas"} <ChevronRight className="size-4" /></button>}</div>}
        {forYou.length ? <div className="home-priority-list">{forYou.map((item) => { const result = matchResult(item), metadata = parseTrainingMetadata(item.metadata), reminded = metadata ? reminderMap.has(trainingReminderKey(metadata)) : false; return <article key={item.id}><button className="home-priority-main" onClick={() => onOpen(item)}><span className="home-priority-badge">{priorityLabel(item)}</span><strong>{item.title}</strong><small>{[item.level || item.junta || item.category, item.character].filter(Boolean).join(" · ")} · confianza {result.confidence}% · {item.source}</small>{result.status !== "unconfigured" && <span className="home-match">{result.score}% compatible</span>}</button><div className="home-priority-actions"><button onClick={() => onOpen(item)}>Ver</button>{item.kind === "capacitacion" && metadata?.registrationOpensAt && <button onClick={() => onRemind(item)}><Bell className="size-4" />{reminded ? "Aviso activo" : "Avisarme"}</button>}</div></article>; })}</div> : !nextTraining && <p className="home-empty-line">No hay oportunidades compatibles nuevas por ahora.</p>}
        {profileNeedsDetail && <button className="home-profile-nudge" onClick={() => onView("perfil")}><span><strong>{profileReady ? "Sumá detalles a tu perfil" : "Completá tu perfil"}</strong><small>{profileReady ? "Necesitamos más coincidencias verificables para personalizar tus oportunidades." : "Recibí oportunidades más precisas."}</small></span><ChevronRight className="size-5" /></button>}
      </>}
    </section>

    <section className="home-shortcuts" aria-labelledby="home-shortcuts-title"><div className="home-section-title"><div><p>ACCESOS RÁPIDOS</p><h2 id="home-shortcuts-title">Todo lo que necesitás</h2></div></div><div className="home-shortcut-grid">{homeShortcuts.map(({ label, caption, icon: Icon, view, image, query }) => <button key={label} type="button" className={`home-shortcut home-shortcut-${image}`} onClick={() => onView(view, query)}><span className="home-shortcut-icon"><Icon className="size-6" aria-hidden="true" /></span><span className="home-shortcut-copy"><strong>{label}</strong><small>{caption}</small></span><ChevronRight className="home-shortcut-arrow size-4" aria-hidden="true" /></button>)}</div></section>

    <button type="button" onClick={() => onView("comunidad")} className="home-section flex w-full items-center gap-4 rounded-2xl p-4 text-left transition hover:border-sky-200 hover:shadow-sm sm:p-5">
      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-sky-100 text-sky-700"><MessagesSquare className="size-6" aria-hidden="true" /></span>
      <span className="min-w-0 flex-1"><span className="block text-xs font-black uppercase tracking-[.14em] text-sky-700">Comunidad Docente</span><span className="mt-1 block font-extrabold text-[var(--text-primary)]">Preguntá, compartí y ayudá a otros docentes</span><span className="mt-1 block text-sm text-[var(--text-muted)]">Conversaciones y respuestas sobre docencia.</span></span><ChevronRight className="size-5 shrink-0 text-sky-700" aria-hidden="true" />
    </button>

    <section className="home-section home-today"><div className="home-section-title"><div><p>RESUMEN DEL DÍA</p><h2>Hoy en tu actividad docente</h2></div></div><div className="home-summary"><button onClick={() => onView("agenda")}><CalendarDays className="size-5" /><span><strong>{todayEvents}</strong> {todayEvents === 1 ? "evento" : "eventos"}</span><ChevronRight className="size-4" /></button><button onClick={() => onView("vacantes")}><BriefcaseBusiness className="size-5" /><span><strong>{vacancies.length}</strong> oportunidades compatibles</span><ChevronRight className="size-4" /></button><button onClick={() => onView("alertas")}><Bell className="size-5" /><span><strong>{unread.length}</strong> {unread.length === 1 ? "alerta relevante" : "alertas relevantes"}</span><ChevronRight className="size-4" /></button></div></section>

    <section className="home-split"><button onClick={() => onView("agenda")}><span className="home-kicker">PRÓXIMO · AGENDA</span>{nextAgendaEntry ? <><strong>{nextAgendaEntry.title}</strong><small>{dateLabel(nextAgendaEntry.startsAt, true)}</small></> : <><strong>Agenda al día</strong><small>Creá un evento personal cuando lo necesites.</small></>}<span>Ver agenda <ChevronRight className="size-4" /></span></button><button onClick={() => onView("vacantes")}><span className="home-kicker">DESIGNACIONES PARA VOS</span>{vacancies[0] ? <><strong>{vacancies[0].title}</strong><small>{vacancies.length} coincidencias · mejor {matchResult(vacancies[0]).score}%</small></> : <><strong>Sin coincidencias nuevas</strong><small>Te avisaremos cuando aparezcan.</small></>}<span>Ver designaciones <ChevronRight className="size-4" /></span></button></section>

    <section className="home-section"><div className="home-section-title"><div><p>TRÁMITES</p><h2>Información para resolver gestiones</h2></div><button onClick={() => onView("informacion")}>Ver trámites <ChevronRight className="size-4" /></button></div><button className="home-profile-nudge" onClick={() => onView("informacion")}><span><strong>Sueldo, legajo, licencias y certificados</strong><small>Consultá organismos, requisitos publicados y accesos oficiales.</small></span><ChevronRight className="size-5" /></button></section>

    <section className="home-section home-latest"><div className="home-section-title"><div><p>NOVEDADES RELEVANTES</p><h2>Información para tu actividad</h2></div><button onClick={() => onView("junta")}>Ver todas <ChevronRight className="size-4" /></button></div>{importantNotice && <button className="home-alert" onClick={() => onOpen(importantNotice.publication!)}><span>📣</span><span><strong>{isGeneralNotice(importantNotice.publication!) ? "INFORMACIÓN GENERAL" : "NOVEDAD PARA VOS"}</strong><small>{importantNotice.notice.title}</small></span><ChevronRight className="size-5" /></button>}{latest.length ? <div>{latest.map((item) => <CompactItem key={item.id} item={item} saved={savedMap.has(item.id)} onOpen={() => onOpen(item)} />)}</div> : !importantNotice && <p className="home-empty-line">No hay novedades relevantes nuevas.</p>}</section>
  </div>;
}

function HomeSkeleton() { return <div className="home-skeleton" aria-label="Cargando oportunidades"><span /><span /><span /></div>; }

function ReminderDialog({ publication, advances, onAdvances, onClose, onSave }: { publication: Publication | null; advances: number[]; onAdvances: (value: number[]) => void; onClose: () => void; onSave: () => void }) {
  const metadata = publication ? parseTrainingMetadata(publication.metadata) : null;
  const options: [number, string][] = [[10080, "7 días antes"], [4320, "3 días antes"], [1440, "1 día antes"], [60, "1 hora antes"], [0, "Cuando abra"]];
  return <Dialog open={Boolean(publication)} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-[#062b55]"><Bell className="size-5 text-[#0878be]" />Avisarme cuando abra</DialogTitle><DialogDescription>{publication?.title}</DialogDescription></DialogHeader>{metadata?.registrationOpensAt && <div className="rounded-2xl bg-[#edf6fc] p-4 text-sm text-[#335f7d]"><strong className="block">Apertura: {dateLabel(metadata.registrationOpensAt, Boolean(metadata.registrationHasTime))}</strong>{metadata.dateStatus === "tentative" ? <span>Fecha tentativa según {metadata.source}.</span> : !metadata.registrationHasTime && <span>La fuente oficial informa la fecha pero no el horario exacto.</span>}</div>}<fieldset className="space-y-2"><Label asChild><legend>Podés elegir más de un aviso</legend></Label>{options.map(([minutes, label]) => <button type="button" key={minutes} aria-pressed={advances.includes(minutes)} onClick={() => onAdvances(advances.includes(minutes) ? advances.filter((value) => value !== minutes) : [...advances, minutes])} className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-4 text-left font-semibold ${advances.includes(minutes) ? "border-[#0878be] bg-[#edf6fc] text-[#075c91]" : "border-[var(--border)] bg-[var(--surface-primary)] text-[var(--text-secondary)]"}`}><span>{label}</span><span>{advances.includes(minutes) ? "✓" : ""}</span></button>)}</fieldset><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={onSave} disabled={!advances.length} className="bg-[#0878be] text-white"><Bell className="size-4" />Activar {advances.length || ""} {advances.length === 1 ? "aviso" : "avisos"}</Button></DialogFooter></DialogContent></Dialog>;
}

function ManualEventDialog({ event, initialDate, onClose, onSaved }: { event: ManualEvent | null; initialDate: string; onClose: () => void; onSaved: () => Promise<void> }) {
  const starts = event?.starts_at ? new Date(event.starts_at) : new Date();
  const existingMinutes = event?.reminder_minutes ?? (event?.reminder_at ? Math.round((starts.getTime() - new Date(event.reminder_at).getTime()) / 60_000) : null);
  const [title, setTitle] = useState(event?.title || ""), [date, setDate] = useState(!event?.id && initialDate ? initialDate : event?.starts_at ? dateTimeInput(event.starts_at) : dateTimeInput(starts.toISOString())), [notes, setNotes] = useState(event?.notes || ""), [category, setCategory] = useState(event?.category || "Personal"), [allDay, setAllDay] = useState(Boolean(event?.all_day)), [recurrence, setRecurrence] = useState<"none" | "daily" | "weekly" | "monthly">(event?.recurrence || "none"), [reminder, setReminder] = useState(existingMinutes == null ? "none" : [0, 10, 30, 60, 1440].includes(existingMinutes) ? String(existingMinutes) : "custom"), [customMinutes, setCustomMinutes] = useState(existingMinutes != null && ![0, 10, 30, 60, 1440].includes(existingMinutes) ? String(existingMinutes) : "15"), [busy, setBusy] = useState(false);
  const open = true;
  const save = async () => {
    if (!title.trim() || !date) return;
    const starts = allDay ? new Date(`${date.slice(0, 10)}T00:00:00`) : new Date(date);
    const reminderMinutes = reminder === "none" ? null : reminder === "custom" ? Math.max(1, Number(customMinutes) || 1) : Number(reminder);
    const reminderAt = reminderMinutes == null ? undefined : new Date(starts.getTime() - reminderMinutes * 60_000).toISOString();
    setBusy(true);
    const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "save_event", id: event?.id, title, notes, category, startsAt: starts.toISOString(), allDay, recurrence, reminderMinutes, reminderAt }) });
    setBusy(false); if (!response.ok) { toast.error("No se pudo guardar el evento"); return; }
    toast.success("Evento guardado en Agenda"); await onSaved();
  };
  const remove = async () => {
    if (!event?.id || !confirm("¿Eliminar este evento de la Agenda?")) return;
    const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "delete_event", id: event.id }) });
    if (!response.ok) { toast.error("No se pudo eliminar el evento"); return; }
    toast.success("Evento eliminado"); await onSaved();
  };
  return <Dialog open={open} onOpenChange={(value) => !value && onClose()}><DialogContent className="max-h-[90dvh] overflow-y-auto"><DialogHeader><DialogTitle className="text-[var(--text-primary)]">{event ? "Editar evento" : "+ Evento"}</DialogTitle><DialogDescription>Tu calendario personal: el recordatorio usa las preferencias push que ya autorizaste en este dispositivo.</DialogDescription></DialogHeader><div className="space-y-3"><label className="space-y-1 text-sm font-semibold">Título<Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Ej. Reunión de padres" className="mt-1 h-11 rounded-xl" /></label><label className="flex items-center justify-between rounded-xl border border-[var(--border)] p-3 text-sm font-semibold">Todo el día <Switch checked={allDay} onCheckedChange={setAllDay} /></label><label className="space-y-1 text-sm font-semibold">{allDay ? "Fecha" : "Fecha y hora"}<Input type={allDay ? "date" : "datetime-local"} value={allDay ? date.slice(0, 10) : date} onChange={(event) => setDate(event.target.value)} className="mt-1 h-11 rounded-xl" /></label><label className="space-y-1 text-sm font-semibold">Categoría<Select value={category} onValueChange={(value) => setCategory(value || "Personal")}><SelectTrigger className="mt-1 h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="Personal">Personal</SelectItem><SelectItem value="Escuela">Escuela</SelectItem><SelectItem value="Designación">Designación</SelectItem><SelectItem value="Capacitación">Capacitación</SelectItem><SelectItem value="Trámite">Trámite</SelectItem><SelectItem value="Recordatorio">Recordatorio</SelectItem></SelectContent></Select></label><label className="space-y-1 text-sm font-semibold">Repetir<Select value={recurrence} onValueChange={(value) => setRecurrence((value || "none") as typeof recurrence)}><SelectTrigger className="mt-1 h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">No se repite</SelectItem><SelectItem value="daily">Todos los días</SelectItem><SelectItem value="weekly">Todas las semanas</SelectItem><SelectItem value="monthly">Todos los meses</SelectItem></SelectContent></Select></label><label className="space-y-1 text-sm font-semibold">Recordarme<Select value={reminder} onValueChange={(value) => setReminder(value || "none")}><SelectTrigger className="mt-1 h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">Sin recordatorio</SelectItem><SelectItem value="0">A la hora del evento</SelectItem><SelectItem value="10">10 minutos antes</SelectItem><SelectItem value="30">30 minutos antes</SelectItem><SelectItem value="60">1 hora antes</SelectItem><SelectItem value="1440">1 día antes</SelectItem><SelectItem value="custom">Personalizado</SelectItem></SelectContent></Select>{reminder === "custom" && <Input type="number" min="1" max="43200" value={customMinutes} onChange={(event) => setCustomMinutes(event.target.value)} aria-label="Minutos antes" className="mt-2 h-11 rounded-xl" />}</label><label className="space-y-1 text-sm font-semibold">Descripción / notas<Textarea value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1 min-h-20 rounded-xl" /></label></div><DialogFooter className="flex-wrap">{event && <Button type="button" variant="outline" onClick={() => void remove()}>Eliminar</Button>}<Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={() => void save()} disabled={busy || !title.trim() || !date} className="bg-[#0878be] text-white">Guardar</Button></DialogFooter></DialogContent></Dialog>;
}

function AgendaDialog({ publication, at, notes, reminder, onAt, onNotes, onReminder, onClose, onSave }: { publication: Publication | null; at: string; notes: string; reminder: string; onAt: (value: string) => void; onNotes: (value: string) => void; onReminder: (value: string) => void; onClose: () => void; onSave: () => void }) {
  return <Dialog open={Boolean(publication)} onOpenChange={(open) => !open && onClose()}><DialogContent><DialogHeader><DialogTitle className="flex items-center gap-2 text-[var(--text-primary)]"><CalendarDays className="size-5 text-[var(--accent-text)]" />Agendar trámite</DialogTitle><DialogDescription>{publication?.title}</DialogDescription></DialogHeader><div className="space-y-4"><div className="space-y-2"><Label htmlFor="procedure-agenda-at">Fecha y hora</Label><Input id="procedure-agenda-at" type="datetime-local" value={at} onChange={(event) => onAt(event.target.value)} className="h-11 rounded-xl" /></div><div className="space-y-2"><Label>Recordatorio</Label><Select value={reminder} onValueChange={(value) => onReminder(value || "one_day")}><SelectTrigger className="h-11 rounded-xl"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="one_day">1 día antes</SelectItem><SelectItem value="one_hour">1 hora antes</SelectItem><SelectItem value="at_time">A la hora elegida</SelectItem><SelectItem value="none">Sin recordatorio</SelectItem></SelectContent></Select></div><div className="space-y-2"><Label htmlFor="procedure-agenda-notes">Notas</Label><Textarea id="procedure-agenda-notes" value={notes} onChange={(event) => onNotes(event.target.value)} placeholder="Ej. Llevar DNI y copias" className="min-h-24 rounded-xl" /></div><p className="text-sm text-[var(--text-muted)]">Esta fecha es personal y no modifica la información oficial del trámite.</p></div><DialogFooter><Button variant="outline" onClick={onClose}>Cancelar</Button><Button onClick={onSave} disabled={!at} className="bg-[#0878be] text-white"><CalendarDays className="size-4" />Guardar en Agenda</Button></DialogFooter></DialogContent></Dialog>;
}

function InformationAgendaAction({ publication, saved, onSchedule, onRemove }: { publication: Publication | null; saved?: Saved; onSchedule: (item: Publication) => void; onRemove: (item: Publication) => void }) {
  if (!publication) return null;
  const scheduled = Boolean(saved?.in_agenda);
  return <div className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[70] ml-auto max-w-[34rem] rounded-2xl border border-[var(--border)] bg-[var(--surface)]/95 p-2 shadow-xl backdrop-blur sm:right-3 sm:left-auto sm:w-[calc(36rem-1.5rem)]"><Button type="button" variant={scheduled ? "outline" : "default"} onClick={() => scheduled ? onRemove(publication) : onSchedule(publication)} className={`h-11 w-full rounded-xl ${scheduled ? "bg-white" : "bg-[#0878be] text-white"}`}><CalendarDays className="size-4" />{scheduled ? `Agendado${saved?.agenda_at ? ` · ${dateLabel(saved.agenda_at, true)}` : ""} · Quitar` : "Agendar trámite con fecha y notas"}</Button></div>;
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

function VisualSectionBanner({ kind, title, description, action }: { kind: "vacantes" | "capacitaciones" | "agenda" | "informacion" | "padrones" | "novedades"; title: string; description: string; action?: ReactNode }) {
  return <header className={`dt-visual-banner dt-banner-${kind}`}>
    <div className="dt-banner-copy"><p className="dt-banner-eyebrow">DocenteTuc · Tucumán</p><h1>{title}</h1><p>{description}</p></div>
    {action && <div className="dt-banner-action">{action}</div>}
  </header>;
}

function PageHeader({ view, count, filter = "todas", query = "", syncing = false, onSync, onAskAI }: { view: View; count: number; filter?: string; query?: string; syncing?: boolean; onSync?: () => void; onAskAI?: () => void }) {
  const [defaultTitle, subtitle] = viewTitles[view];
  const isNovedades = filter === "nuevas" || (filter !== "comunicados" && /novedad/.test(normalize(query)));
  const isComunicados = filter === "comunicados" || (filter !== "nuevas" && /comunicad/.test(normalize(query)));
  const isNewsTab = view === "junta" && (isNovedades || isComunicados);
  const title = isNewsTab ? (isNovedades ? "Novedades" : "Comunicados") : defaultTitle;
  const action = <div className="flex flex-wrap gap-2">{onAskAI && <Button onClick={onAskAI} className="rounded-xl bg-[#0878be] text-[var(--text-on-accent)]"><Sparkles className="size-4" />Preguntar a IA</Button>}{onSync && <Button onClick={onSync} disabled={syncing} variant="outline" className="dt-refresh-button rounded-xl"><RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} />Actualizar</Button>}</div>;
  const kind = view === "vacantes" || view === "capacitaciones" ? view : view === "junta" ? (isNewsTab ? "novedades" : "padrones") : "informacion";
  return <VisualSectionBanner kind={kind} title={title} description={view === "perfil" ? subtitle : `${subtitle} · ${count} resultados`} action={action} />;
}

function Filters({ filter, setFilter: onFilterChange, junta, setJunta, character, setCharacter, query, setQuery, kind, date, setDate, source, setSource: onSourceChange, compatibility, setCompatibility, sort, setSort, hasTrainingTerritoryData, circuit, setCircuit }: { filter: string; setFilter: (value: string) => void; junta: (typeof OFFICIAL_JUNTAS)[number]["id"] | "todas"; setJunta: (value: (typeof OFFICIAL_JUNTAS)[number]["id"] | "todas") => void; character: string; setCharacter: (value: string) => void; query: string; setQuery: (value: string) => void; kind: View; date: string; setDate: (value: string) => void; source: string; setSource: (value: string) => void; compatibility: string; setCompatibility: (value: string) => void; sort: string; setSort: (value: string) => void; hasTrainingTerritoryData: boolean; circuit: string; setCircuit: (value: string) => void }) {
  const setFilter = (value: string) => onFilterChange(value);
  const setSource = (value: string) => onSourceChange(value);
  const activeFilterCount = kind === "capacitaciones" ? Number(source !== "todas") + Number(filter !== "para-mi") + Number(character !== "todos") + Number(date !== "") + Number(compatibility !== "todas") + Number(circuit !== "todos") : Number(junta !== "todas") + Number(character !== "todos") + Number(kind === "vacantes" && circuit !== "todos") + Number(query.trim() !== "");
  const clearTrainingFilters = () => { setSource("todas"); setCharacter("todos"); setDate(""); setCompatibility("todas"); setCircuit("todos"); setFilter("para-mi"); };
  const clearDesignationFilters = () => { setJunta("todas"); setCharacter("todos"); setCircuit("todos"); setQuery(""); setFilter("para-mi"); };
  const tabs = kind === "capacitaciones" ? [["para-mi", "⭐ Para mí"], ["proximamente", "Próximas"], ["abiertas", "Abiertas"]] as const : kind === "junta" ? [["para-mi", "Para mí"], ["todas", "Todo"], ["llamados", "Llamados abiertos"], ["padrones", "Padrones"], ["comunicados", "Comunicados"], ["nuevas", "Novedades"]] as const : kind === "vacantes" ? [["para-mi", "⭐ Para mí"], ["todas", "Todas"], ["finalizadas", "Finalizadas"]] as const : [["para-mi", "Para mí"], ["todas", "Todas"]] as const;
  return <section className="mb-6 rounded-2xl border border-[#c8e1f1] bg-white p-3 shadow-sm">
    {kind === "capacitaciones" && <><p className="mb-1 text-xs font-black uppercase tracking-wide text-[#52708c]">Plataformas</p><div className="flex flex-wrap gap-2 pb-1">{[["platform:fdci", "FDCI"], ["platform:infod", "INFoD"], ["platform:cenet", "CeNET"], ["todas", "Ver todas"]].map(([id, label]) => <FilterChip key={id} onClick={() => setSource(id)} selected={source === id} className="min-h-10 px-4 text-sm font-bold">{label}</FilterChip>)}</div>{source !== "todas" && <p className="mt-1 text-xs font-semibold text-[#315d7a]">{source === "platform:fdci" ? "FDCI" : source === "platform:infod" ? "INFoD / AulaS-TIC" : "CeNET / INET"} <button onClick={() => setSource("todas")} className="ml-1 underline">× Quitar filtro</button></p>}</>}
    <div className="mt-2 flex gap-2 overflow-x-auto border-t border-[#e3eff7] pt-2">{tabs.map(([id, label]) => <FilterChip key={id} onClick={() => setFilter(id)} selected={filter === id} className="min-h-9 shrink-0 px-3 text-xs font-bold">{label}</FilterChip>)}</div>
    {kind === "vacantes" && <div className="mt-2 grid grid-cols-1 gap-2 border-t border-[#e3eff7] pt-2 min-[460px]:grid-cols-2"><Select value={junta} onValueChange={(value) => setJunta((value || "todas") as typeof junta)}><SelectTrigger className="h-10 min-w-0 rounded-xl border-[#c8e1f1]"><SelectValue placeholder="Junta" /></SelectTrigger><SelectContent><SelectItem value="todas">Todas las juntas</SelectItem>{OFFICIAL_JUNTAS.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select><Select value={character} onValueChange={(value) => setCharacter(value || "todos")}><SelectTrigger className="h-10 min-w-0 rounded-xl border-[#c8e1f1]"><SelectValue placeholder="Carácter" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos los caracteres</SelectItem>{OFFICIAL_CHARACTERS.map((item) => <SelectItem key={item} value={item}>{item}</SelectItem>)}</SelectContent></Select><Select value={circuit} onValueChange={(value) => setCircuit(value || "todos")}><SelectTrigger className="h-10 min-w-0 rounded-xl border-[#c8e1f1] min-[460px]:col-span-2"><SelectValue placeholder="Circuito territorial" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos los circuitos</SelectItem>{TUCUMAN_CIRCUITS.map((item) => <SelectItem key={item.id} value={item.id}>Circuito {item.id}</SelectItem>)}</SelectContent></Select><div className="relative min-w-0 min-[460px]:col-span-2"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[#52708c]" /><Input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Buscar cargo, materia o establecimiento" placeholder="Buscar cargo, materia o establecimiento..." className="h-10 rounded-xl border-[#c8e1f1] bg-white pl-10" />{query && <button aria-label="Limpiar búsqueda de designaciones" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 p-2"><X className="size-4" /></button>}</div>{activeFilterCount > 0 && <Button type="button" variant="outline" onClick={clearDesignationFilters} className="min-h-9 rounded-xl min-[460px]:col-span-2">Quitar filtros</Button>}</div>}
    {kind === "junta" && <details className="mt-2 border-t border-[#e3eff7] pt-2"><summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-bold text-[#17466b]"><SlidersHorizontal className="size-4 text-[#0878be]" />Filtrar por Junta<span className="ml-auto text-xs font-medium text-[#52708c]">{junta === "todas" ? "Opcional" : "1 activo"}</span></summary><Select value={junta} onValueChange={(value) => setJunta((value || "todas") as typeof junta)}><SelectTrigger className="mt-2 h-10 rounded-xl border-[#c8e1f1]"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="todas">Todas las juntas</SelectItem>{OFFICIAL_JUNTAS.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></details>}
    {kind === "capacitaciones" && <details className="mt-2 border-t border-[#e3eff7] pt-2"><summary className="flex min-h-10 cursor-pointer list-none items-center gap-2 font-bold text-[#17466b]"><SlidersHorizontal className="size-4 text-[#0878be]" />Filtros<span className="ml-auto text-xs font-medium text-[#52708c]">{activeFilterCount ? `${activeFilterCount} activos` : "Opcional"}</span></summary><div className="flex flex-wrap gap-2 pt-2">{activeFilterCount > 0 && <Button type="button" variant="outline" onClick={clearTrainingFilters} className="min-h-9 rounded-xl">Quitar filtros</Button>}

    {kind === "capacitaciones" && <><FilterChip onClick={() => setFilter("sin-fecha")} selected={filter === "sin-fecha"} className="min-h-9 px-3 text-xs font-bold">Fecha no confirmada</FilterChip><Select value={character} onValueChange={(value) => setCharacter(value || "todos")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Modalidad" /></SelectTrigger><SelectContent><SelectItem value="todos">Toda modalidad</SelectItem><SelectItem value="virtual">Virtual</SelectItem><SelectItem value="presencial">Presencial</SelectItem><SelectItem value="semipresencial">Semipresencial / mixta</SelectItem></SelectContent></Select><Select value={compatibility} onValueChange={(value) => setCompatibility(value || "todas")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Compatibilidad" /></SelectTrigger><SelectContent><SelectItem value="todas">Toda compatibilidad</SelectItem><SelectItem value="high">85% o más · Alta</SelectItem><SelectItem value="good">70–84% · Parcial</SelectItem><SelectItem value="partial">50–69% · Baja</SelectItem><SelectItem value="unknown">Sin determinar</SelectItem></SelectContent></Select><Select value={sort} onValueChange={(value) => setSort(value || "recommended")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Ordenar" /></SelectTrigger><SelectContent><SelectItem value="recommended">Recomendadas</SelectItem><SelectItem value="opening">Próxima apertura</SelectItem><SelectItem value="open">Abiertas</SelectItem><SelectItem value="recent">Más recientes</SelectItem></SelectContent></Select><div className="flex gap-2"><FilterChip onClick={() => setDate(date === "week" ? "" : "week")} selected={date === "week"} className="min-h-9 px-3 text-xs font-bold">Abren esta semana</FilterChip><FilterChip onClick={() => setDate(date === "month" ? "" : "month")} selected={date === "month"} className="min-h-9 px-3 text-xs font-bold">Este mes</FilterChip></div>{hasTrainingTerritoryData && source === "platform:fdci" && <Select value={circuit} onValueChange={(value) => setCircuit(value || "todos")}><SelectTrigger className="h-9 rounded-xl border-[#dce8e1]"><SelectValue placeholder="Circuito" /></SelectTrigger><SelectContent><SelectItem value="todos">Todos los circuitos</SelectItem>{TUCUMAN_CIRCUITS.map((item) => <SelectItem key={item.id} value={item.id}>Circuito {item.id}</SelectItem>)}</SelectContent></Select>}</>}
    </div></details>}
  </section>;
}

function DesignationEmptyState({ profileRequired, sourceUnavailable, sourceVerifiedEmpty, onCompleteProfile }: { profileRequired: boolean; sourceUnavailable: boolean; sourceVerifiedEmpty: boolean; onCompleteProfile: () => void }) {
  return <div className="grid gap-3" aria-live="polite">
    {profileRequired && <Card className="rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] p-6 text-center">
      <h2 className="font-bold text-[var(--text-primary)]">Completá tu Perfil docente para ver las designaciones más compatibles con vos.</h2>
      <Button onClick={onCompleteProfile} className="mt-4 min-h-10 rounded-xl">Completar perfil docente</Button>
    </Card>}
    {sourceUnavailable && <div role="status" className="grid min-h-40 place-items-center rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface-primary)] p-6 text-center">
      <div><h2 className="font-bold text-[var(--text-primary)]">No pudimos actualizar las designaciones en este momento.</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Intentá nuevamente más tarde.</p></div>
    </div>}
    {sourceVerifiedEmpty && <div role="status" className="grid min-h-40 place-items-center rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface-primary)] p-6 text-center">
      <p className="font-semibold text-[var(--text-secondary)]">SIME verificó la fuente y por ahora no hay designaciones disponibles.</p>
    </div>}
  </div>;
}

function PublicationList({ items, loading, savedMap, reminderMap, matchResult, onOpen, onSave, onRemind, emptyContext, onClearFilters }: { items: Publication[]; loading: boolean; savedMap: Map<string, Saved>; reminderMap: Map<string, TrainingReminder>; matchResult: (item: Publication) => MatchResult; onOpen: (item: Publication) => void; onSave: (item: Publication, enabled: boolean) => void; onRemind: (item: Publication) => void; emptyContext: string; onClearFilters: () => void }) {
  if (loading) return <LoadingCards />; if (!items.length) return <div className="grid min-h-52 place-items-center rounded-3xl border border-dashed border-[var(--border)] bg-[var(--surface-primary)] p-6 text-center"><div><h2 className="font-bold text-[var(--text-primary)]">{emptyContext === "las plataformas seleccionadas" ? "No encontramos resultados" : `No encontramos resultados de ${emptyContext}`}</h2><p className="mt-1 text-sm text-[var(--text-secondary)]">Puede que los filtros actuales estén limitando la búsqueda. La información menos compatible sigue disponible en Ver todas.</p><Button variant="outline" onClick={onClearFilters} className="mt-4 min-h-10 rounded-xl">Quitar filtros</Button></div></div>;
  return <div className="grid gap-4 xl:grid-cols-2">{items.map((item) => {
    const saved = savedMap.has(item.id), compatibility = matchResult(item), training = item.kind === "capacitacion", metadata = training ? parseTrainingMetadata(item.metadata) : null, reminded = metadata ? reminderMap.has(trainingReminderKey(metadata)) : false;
    const lifecycle = publicationLifecycleForUI(item), trainingState = training ? enrollmentForUI(item) : null, statusText = training ? enrollmentLabel(item) : item.kind === "vacante" ? lifecycleLabel(lifecycle) : item.status, simeCode = item.kind === "vacante" ? simeCodeForPublication(item) : "";
    const statusTone = training
      ? trainingState === "ABIERTA" ? "success" : trainingState === "ABRE_HOY" || trainingState === "PROXIMAMENTE" ? "warning" : "neutral"
      : lifecycle === "ACTIVE" ? "success" : lifecycle === "UPCOMING" ? "info" : "warning";
    return <Card as="article" key={item.id} className={`dt-publication-card flex flex-col rounded-3xl p-4 shadow-[0_8px_30px_rgba(20,64,52,.04)] ${item.kind === "vacante" ? "min-h-[190px]" : "min-h-[230px]"}`}>
      <div className="mb-3 flex items-start justify-between gap-3"><div className="flex flex-wrap gap-2"><StatusBadge>{publicationLabel(item)}</StatusBadge>{training && <StatusBadge tone="info">{item.source}</StatusBadge>}<StatusBadge tone={statusTone}>{trainingState === "ABIERTA" ? "🟢 " : ""}{statusText}</StatusBadge><MatchBadge result={compatibility} /></div>{!training && <button onClick={() => onSave(item, !saved)} aria-label={saved ? "Quitar de guardados" : "Guardar publicación"} className={`grid size-10 shrink-0 place-items-center rounded-xl ${saved ? "bg-[#fff3dd] text-[#a46c20]" : "bg-[#f1f5f2] text-[#6d837a]"}`}><Star className={`size-5 ${saved ? "fill-current" : ""}`} /></button>}</div>
      {metadata?.registrationOpensAt && (trainingState === "PROXIMAMENTE" || trainingState === "ABRE_HOY") && <div className="mb-4 rounded-2xl bg-[#fff4d6] p-4 text-[#6f4c00]"><strong className="block text-lg">{metadata.dateStatus === "tentative" ? "Fecha prevista · confirmar en fuente" : openingCountdown(metadata.registrationOpensAt, new Date(), metadata.registrationHasTime)}</strong><span className="text-sm">Abre: {dateLabel(metadata.registrationOpensAt, Boolean(metadata.registrationHasTime))}{metadata.registrationHasTime ? " hs" : ""}</span></div>}
      <button onClick={() => onOpen(item)} className="text-left"><h2 className="line-clamp-2 text-lg font-bold leading-snug hover:underline">{item.title}</h2><p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[#657b73]">{item.summary || `Información publicada por ${item.source}.`}</p></button>
      {simeCode && <p className="mt-2 text-xs font-bold text-[#315d7a]">ID de trámite: {simeCode}</p>}
      {training ? <div className="mt-4 grid grid-cols-2 gap-2 text-sm text-[#61766f]">{item.character && <span><strong>Modalidad:</strong> {item.character}</span>}{item.starts_at && <span><strong>Inicio:</strong> {dateLabel(item.starts_at)}</span>}{metadata?.registrationClosesAt && <span><strong>Inscripción hasta:</strong> {dateLabel(metadata.registrationClosesAt, true)}</span>}{item.location && <span className="col-span-2"><strong>Lugar:</strong> {item.location}</span>}</div> : <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-[#61766f]">{item.character && <span>{item.character}</span>}{item.junta && <span>{item.junta}</span>}{item.shift && <span>Turno {item.shift}</span>}{item.ends_at && <span className="ml-auto flex items-center gap-1 font-semibold text-[#9a641f]"><Clock3 className="size-4" />{fromNow(item.ends_at)}</span>}</div>}
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[#e7eee9] pt-3">
        {training && metadata?.registrationOpensAt && (trainingState === "PROXIMAMENTE" || (trainingState === "ABRE_HOY" && metadata.registrationHasTime)) && <button onClick={() => onRemind(item)} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#fff4d6] px-3 text-sm font-bold text-[#7b5500]"><Bell className="size-4" />{reminded ? "Aviso activo" : "Recordarme"}</button>}
        {training && <button onClick={() => onSave(item, !saved)} className={`flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold ${saved ? "bg-[#fff3dd] text-[#8b5b00]" : "bg-[#edf6fc] text-[#0878be]"}`}><Star className={`size-4 ${saved ? "fill-current" : ""}`} />{saved ? "Guardada" : "Guardar"}</button>}
        <button onClick={() => onOpen(item)} className="flex min-h-10 items-center gap-2 rounded-xl px-3 text-sm font-bold text-[#1f5f4e] hover:bg-[#edf4ef]">Ver <ChevronRight className="size-4" /></button>
        {training && trainingState === "ABIERTA" && metadata?.commissionId && <a href={item.official_url} target="_blank" rel="noreferrer" className="flex min-h-10 items-center gap-2 rounded-xl bg-[#0878be] px-4 text-sm font-black text-white">INSCRIBIRME <ExternalLink className="size-4" /></a>}
      </div>
    </Card>;
  })}</div>;
}

function MatchBadge({ result }: { result: MatchResult }) { return <CompatibilityBadge result={result} />; }

function CompactItem({ item, saved, onOpen }: { item: Publication; saved: boolean; onOpen: () => void }) { return <button onClick={onOpen} className="flex w-full items-center gap-4 py-4 text-left"><span className={`grid size-11 shrink-0 place-items-center rounded-2xl ${item.kind === "vacante" ? "bg-[#e2f4ff] text-[#0878be]" : item.kind === "capacitacion" ? "bg-[#dff7ff] text-[#0878be]" : "bg-[#e8efff] text-[#1b4e96]"}`}>{item.kind === "vacante" ? <BriefcaseBusiness className="size-5" /> : item.kind === "capacitacion" ? <GraduationCap className="size-5" /> : <BookOpen className="size-5" />}</span><span className="min-w-0 flex-1"><span className="line-clamp-1 font-bold text-[#062b55]">{item.title}</span><span className="mt-1 block text-sm text-[#52708c]">{item.ends_at ? fromNow(item.ends_at) : item.category} · {item.source}</span></span>{saved && <Star className="size-4 fill-[#f4b942] text-[#c88608]" />}<ChevronRight className="size-5 text-[#8aa9bf]" /></button>; }

function Agenda({ publications, savedMap, manualEvents, onOpen, onNewEvent, onEditEvent }: { publications: Publication[]; savedMap: Map<string, Saved>; manualEvents: ManualEvent[]; onOpen: (item: Publication) => void; onNewEvent: (date?: string) => void; onEditEvent: (event: ManualEvent) => void }) {
  const [mode, setMode] = useState<"month" | "week" | "agenda">("month"), [month, setMonth] = useState(() => { const date = new Date(); return new Date(date.getFullYear(), date.getMonth(), 1); }), [category, setCategory] = useState("todas"), [weekOffset, setWeekOffset] = useState(0);
  const now = new Date();
  const publicationEvents = publications.filter((item) => Boolean(savedMap.get(item.id)?.in_agenda) && safeDate(parseTrainingMetadata(item.metadata)?.registrationOpensAt || item.ends_at || item.starts_at)).map((item) => ({ id: `publication:${item.id}`, title: item.title, category: item.kind === "vacante" ? "Designación" : item.category, starts_at: parseTrainingMetadata(item.metadata)?.registrationOpensAt || item.ends_at || item.starts_at!, manual: false as const, item }));
  const events = [...manualEvents.map((item) => ({ ...item, manual: true as const })), ...publicationEvents].filter((item) => category === "todas" || item.category === category).sort((a, b) => new Date(a.starts_at).getTime() - new Date(b.starts_at).getTime());
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate(), firstDay = (new Date(month.getFullYear(), month.getMonth(), 1).getDay() + 6) % 7, calendarCells = Array.from({ length: Math.ceil((firstDay + daysInMonth) / 7) * 7 }, (_, index) => { const day = index - firstDay + 1; return day > 0 && day <= daysInMonth ? new Date(month.getFullYear(), month.getMonth(), day) : null; });
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - (now.getDay() + 6) % 7 + weekOffset * 7); weekStart.setHours(0, 0, 0, 0);
  const weekDays = Array.from({ length: 7 }, (_, index) => { const date = new Date(weekStart); date.setDate(weekStart.getDate() + index); return date; });
  const dateInput = (date: Date) => { const local = new Date(date); local.setHours(9, 0, 0, 0); return dateTimeInput(local.toISOString()); };
  const eventForDay = (date: Date) => events.filter((event) => {
    const start = new Date(event.starts_at), day = tucumanDay(date), first = tucumanDay(start);
    if (event.manual && "recurrence" in event && event.recurrence && event.recurrence !== "none") {
      if (day < first) return false;
      if (event.recurrence === "daily") return true;
      if (event.recurrence === "weekly") return date.getDay() === start.getDay();
      if (event.recurrence === "monthly") { const last = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate(); return date.getDate() === Math.min(start.getDate(), last); }
    }
    return first === day;
  });
  const agendaRow = (event: typeof events[number]) => <article key={event.id} className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] p-3"><span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[var(--accent-soft)] text-center text-xs font-black text-[var(--accent-text)]">{new Date(event.starts_at).getDate()}<small>{new Intl.DateTimeFormat("es-AR", { month: "short" }).format(new Date(event.starts_at))}</small></span><button className="min-w-0 flex-1 text-left" onClick={() => event.manual ? onEditEvent(event) : event.item && onOpen(event.item)}><strong className="block truncate text-[var(--text-primary)]">{event.title}</strong><small className="text-[var(--text-muted)]">{event.category} · {dateLabel(event.starts_at, true)}</small></button>{event.manual && <span className="text-xs font-bold text-[var(--accent-text)]">Personal</span>}</article>;
  return <section className="space-y-3">
    <VisualSectionBanner kind="agenda" title="Agenda docente" description="Organizá tus eventos personales y fechas importantes." action={<Button onClick={() => onNewEvent()} className="min-h-11 rounded-xl border border-white/35 bg-white px-4 font-black text-[#064477] hover:bg-[#e9f7ff]"><span className="text-lg">+</span> Evento</Button>} />
    <div className="agenda-tabs grid grid-cols-3 gap-1 rounded-xl bg-[var(--surface-secondary)] p-1">{([['month','Mes'],['week','Semana'],['agenda','Agenda']] as const).map(([id, label]) => <button key={id} onClick={() => setMode(id)} className={`min-h-11 rounded-lg text-sm font-black ${mode === id ? "bg-[#0878be] text-white" : "text-[var(--text-secondary)]"}`}>{label}</button>)}</div>
    {mode === "month" && <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-3"><div className="mb-3 flex items-center justify-between"><Button variant="outline" size="icon" aria-label="Mes anterior" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹</Button><h2 className="text-lg font-black capitalize text-[var(--text-primary)]">{new Intl.DateTimeFormat("es-AR", { month: "long", year: "numeric" }).format(month)}</h2><Button variant="outline" size="icon" aria-label="Mes siguiente" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>›</Button></div><div className="agenda-calendar-grid grid grid-cols-7 text-center text-xs font-black text-[var(--text-muted)]">{["L", "M", "M", "J", "V", "S", "D"].map((day, index) => <span key={`${day}-${index}`} className="py-1">{day}</span>)}{calendarCells.map((date, index) => <button key={index} disabled={!date} onClick={() => date && onNewEvent(dateInput(date))} className={`min-h-12 rounded-lg p-1 text-sm ${date && tucumanDay(date) === tucumanDay(now) ? "bg-[#dff4ff] font-black text-[#063967]" : "text-[var(--text-primary)]"}`}>{date && <><span>{date.getDate()}</span>{eventForDay(date).length > 0 && <span className="mx-auto mt-1 block size-1.5 rounded-full bg-[#f4b942]" />}</>}</button>)}</div></section>}
    {mode === "week" && <section className="space-y-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-3"><div className="flex items-center justify-between"><Button variant="outline" size="icon" aria-label="Semana anterior" onClick={() => setWeekOffset((value) => value - 1)}>‹</Button><h2 className="text-base font-black text-[var(--text-primary)]">{new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short" }).format(weekDays[0])} – {new Intl.DateTimeFormat("es-AR", { day: "numeric", month: "short", year: "numeric" }).format(weekDays[6])}</h2><Button variant="outline" size="icon" aria-label="Semana siguiente" onClick={() => setWeekOffset((value) => value + 1)}>›</Button></div><div className="grid grid-cols-7 gap-1">{weekDays.map((date) => <button key={date.toISOString()} onClick={() => onNewEvent(dateInput(date))} className={`min-h-16 rounded-xl border p-1 text-center ${tucumanDay(date) === tucumanDay(now) ? "border-[#0878be] bg-[#e5f6ff] text-[#063967]" : "border-[var(--border)] text-[var(--text-primary)]"}`}><span className="block text-xs font-bold">{new Intl.DateTimeFormat("es-AR", { weekday: "short" }).format(date)}</span><strong className="text-sm">{date.getDate()}</strong>{eventForDay(date).length > 0 && <span className="mx-auto mt-1 block size-1.5 rounded-full bg-[#e5aa2e]" />}</button>)}</div><div className="space-y-2">{weekDays.flatMap((date) => eventForDay(date).map((event) => ({ date, event }))).length ? weekDays.flatMap((date) => eventForDay(date).map((event) => ({ date, event }))).map(({ date, event }) => <div key={`${tucumanDay(date)}:${event.id}`}><p className="px-1 pb-1 text-xs font-black uppercase text-[var(--text-muted)]">{new Intl.DateTimeFormat("es-AR", { weekday: "long", day: "numeric", month: "short" }).format(date)}</p>{agendaRow(event)}</div>) : <Empty title="Semana sin eventos" text="Tocá un día o + Evento para organizarte." />}</div></section>}
    {mode === "agenda" && <section className="space-y-2"><div className="flex gap-2 overflow-x-auto pb-1">{[["todas", "Todos"], ["Designación", "Designaciones"], ["Personal", "Personal"], ["Escuela", "Escuela"], ["Capacitación", "Capacitación"], ["Trámite", "Trámites"]].map(([id, label]) => <button key={id} onClick={() => setCategory(id)} aria-pressed={category === id} className={`shrink-0 rounded-full px-3 py-2 text-xs font-black ${category === id ? "bg-[#0878be] text-white" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{label}</button>)}</div>{events.length ? events.map(agendaRow) : <Empty title="Tu agenda está vacía" text="Creá un evento personal con + Evento." />}</section>}
  </section>;
}

function Alerts({ data, onOpen, onRead }: { data: AppData | null; onOpen: (item: Publication) => void; onRead: (id: number) => void }) {
  const [tab, setTab] = useState<"para-mi" | "siguiendo" | "generales" | "todas">("para-mi");
  const publicationMap = new Map((data?.publications || []).map((item) => [item.id, item]));
  const followed = new Set([...(data?.saved || []).map((item) => item.publication_id), ...(data?.reminders || []).map((item) => item.publication_id), ...(data?.designations || []).map((item) => item.publication_id)]);
  const profile = data?.profile;
  const matchProfile = profile ? { levels: profile.levels, areas: profile.areas, subjects: profile.subjects, boards: profile.boards, roles: profile.roles, department: profile.department, locality: profile.locality, shifts: profile.shifts, characters: profile.characters, circuits: profile.circuits, personalMatchThreshold: profile.personal_match_threshold, wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: profile.training_interests } : null;
  const resultByPublication = new Map<string, MatchResult>();
  const matchResult = (item: Publication) => {
    const existing = resultByPublication.get(item.id);
    if (existing) return existing;
    const training = item.kind === "capacitacion" ? parseTrainingMetadata(item.metadata) : null;
    const result = profileMatch({ kind: item.kind, title: item.title, summary: item.summary, level: item.level, area: item.area, role: item.kind === "vacante" ? designationRoleFromTitle(item.title) : undefined, junta: item.junta, location: item.location, shift: item.shift, character: item.character, circuit: item.circuit, sourceCircuitRaw: item.source_circuit_raw, recipients: training?.recipients }, matchProfile || {});
    resultByPublication.set(item.id, result);
    return result;
  };
  const personalized = (item: Publication) => Boolean(matchProfile && !isGeneralNotice(item) && isEligibleMatchResult(matchResult(item), profile?.personal_match_threshold || 85));
  const latestByPublication = new Map<string, Notice>();
  for (const notice of data?.notifications || []) if (!latestByPublication.has(notice.publication_id)) latestByPublication.set(notice.publication_id, notice);
  const all = [...latestByPublication.values()].filter((notice) => publicationMap.has(notice.publication_id));
  const visible = all.filter((notice) => {
    const item = publicationMap.get(notice.publication_id)!;
    if (tab === "para-mi") return personalized(item);
    if (tab === "siguiendo") return followed.has(item.id);
    if (tab === "generales") return isGeneralNotice(item);
    return true;
  });
  return <><PageHeader view="alertas" count={visible.length} syncing={false} />
    <div className="mb-3 flex gap-2 overflow-x-auto">{([["para-mi", "Para mí"], ["siguiendo", "Siguiendo"], ["generales", "Generales"], ["todas", "Todas"]] as const).map(([id, label]) => <button key={id} onClick={() => setTab(id)} aria-pressed={tab === id} className={`min-h-10 shrink-0 rounded-full px-4 text-sm font-bold ${tab === id ? "bg-[#0878be] text-white" : "bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{label}</button>)}</div>
    {!profile?.levels.length && tab === "para-mi" && <div className="mb-3 rounded-2xl border border-[var(--info-border)] bg-[var(--info-bg)] p-4 text-sm text-[var(--info-text)]">Completá tu perfil para recibir recomendaciones más precisas. <button className="ml-1 font-black underline" onClick={() => window.dispatchEvent(new CustomEvent("docentetuc:open-profile"))}>Completar perfil</button></div>}
    {visible.length ? <div className="rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] px-4"><div className="divide-y divide-[var(--border)]">{visible.map((notice) => { const item = publicationMap.get(notice.publication_id)!; const match = personalized(item) ? matchResult(item) : null; return <button key={notice.id} onClick={() => { if (!Boolean(notice.read)) void onRead(notice.id); onOpen(item); }} className="flex w-full items-center gap-3 py-4 text-left"><span className={`size-2 shrink-0 rounded-full ${Boolean(notice.read) ? "bg-[#c7d2cd]" : "bg-[#ee6a4b]"}`} /><span className="min-w-0 flex-1"><span className="block line-clamp-2 font-bold text-[var(--text-primary)]">{item.title}</span><span className="mt-1 block text-sm text-[var(--text-secondary)]">{publicationLabel(item)} · {item.source} · {dateLabel(`${notice.created_at}Z`, true)}</span>{match && <span className="mt-1 block text-xs font-bold text-[var(--accent-text)]">⭐ {match.score}% compatible · confianza {match.confidence}%</span>}</span><ChevronRight className="size-5 shrink-0 text-[var(--text-muted)]" /></button>; })}</div></div> : <Empty title={tab === "para-mi" ? "Todavía no hay alertas compatibles" : "No hay alertas en esta vista"} text={tab === "para-mi" ? "Las oportunidades por debajo del umbral siguen disponibles para consultarlas, pero no se presentan como recomendaciones." : tab === "siguiendo" ? "Guardá, recordá o seguí publicaciones para ver aquí sus novedades." : "Los comunicados generales aparecen aquí cuando hay novedades transversales."} />}
  </>;
}

function MultiValueField({ label, values, placeholder, suggestions = [], onChange }: { label: string; values: string[]; placeholder: string; suggestions?: string[]; onChange: (values: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => { const next = draft.trim(); if (!next || values.some((item) => normalize(item) === normalize(next))) return; onChange([...values, next]); setDraft(""); };
  const available = suggestions.filter((item) => !values.some((value) => normalize(value) === normalize(item)) && (!draft || normalize(item).includes(normalize(draft)))).slice(0, 6);
  return <div className="space-y-2"><Label>{label}</Label><div className="rounded-2xl border border-[var(--border)] bg-[var(--input-background)] p-3"><div className="mb-2 flex flex-wrap gap-2">{values.map((item) => <button type="button" key={item} onClick={() => onChange(values.filter((value) => value !== item))} className="min-h-10 rounded-full bg-[var(--accent-soft)] px-3 text-sm font-bold text-[var(--accent-text)]" aria-label={`Quitar ${item}`}>✓ {item} ×</button>)}</div><div className="flex min-w-0 gap-2"><Input value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === ",") { event.preventDefault(); add(); } }} placeholder={placeholder} className="h-11 min-w-0 flex-1 rounded-xl bg-white" /><Button type="button" variant="outline" onClick={add} className="h-11 shrink-0 rounded-xl">Agregar</Button></div>{available.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{available.map((item) => <button type="button" key={item} onClick={() => onChange([...values, item])} className="rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]">+ {item}</button>)}</div>}</div></div>;
}

function ProfileForm({ profile, roleOptions, onSaved }: { profile?: Profile; roleOptions: string[]; onSaved: () => void }) {
  const [form, setForm] = useState<Profile | null>(() => profile ? {
    ...profile,
    characters: profile.characters.length ? profile.characters : [
      ...(profile.wants_interim ? ["Interino"] : []),
      ...(profile.wants_substitute ? ["Suplente"] : []),
    ],
  } : null);
  const [busy, setBusy] = useState(false);
  if (!form) return <LoadingCards />;
  const hasLevel = (level: string) => form.levels.some((item) => normalize(item) === normalize(level));
  const toggleLevel = (level: string) => setForm((current) => {
    if (!current) return current;
    const selected = current.levels.some((item) => normalize(item) === normalize(level));
    return { ...current, levels: selected ? current.levels.filter((item) => normalize(item) !== normalize(level)) : [...current.levels, level] };
  });
  const toggleList = (key: "characters" | "circuits", value: string) => setForm((current) => current ? { ...current, [key]: current[key].includes(value) ? current[key].filter((item) => item !== value) : [...current[key], value] } : current);
  const toggleBoard = (id: string, label: string) => setForm((current) => current ? { ...current, boards: current.boards.some((value) => normalizeJunta(value) === id) ? current.boards.filter((value) => normalizeJunta(value) !== id) : [...current.boards, label] } : current);
  const save = async () => {
    setBusy(true);
    try {
      const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({
        action: "save_profile", name: form.name, levels: form.levels, areas: form.areas, subjects: form.subjects,
        boards: form.boards, roles: form.roles, department: form.department, locality: form.locality, shifts: form.shifts,
        wantsInterim: form.characters.includes("Interino"), wantsSubstitute: form.characters.includes("Suplente"),
        trainingInterests: form.training_interests, characters: form.characters, circuits: form.circuits,
        personalMatchThreshold: form.personal_match_threshold,
      }) });
      if (!response.ok) throw new Error("No se pudo actualizar el perfil");
      toast.success("Perfil actualizado"); onSaved();
    } catch (error) { toast.error(error instanceof Error ? error.message : "No se pudo actualizar el perfil"); }
    finally { setBusy(false); }
  };
  return (
    <>
      <PageHeader view="perfil" count={0} syncing={false} />
      <form onSubmit={(event) => { event.preventDefault(); void save(); }} className="grid gap-4 rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 text-[var(--text-primary)] sm:p-5 md:grid-cols-2 md:gap-5 md:p-7">
        <div className="md:col-span-2">
          <p className="text-xs font-black uppercase tracking-[.15em] text-[var(--accent-text)]">Perfil privado</p>
          <h2 className="mt-1 text-xl font-black">Tu perfil docente</h2>
          <p className="mt-1 text-sm text-[var(--text-muted)]">Se usa para ordenar oportunidades y capacitaciones. No se muestra en tu perfil público.</p>
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Nombre</Label>
          <Input id="name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Tu nombre" className="h-11 rounded-xl border-[var(--border)] bg-white" />
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Niveles en los que trabajo / puedo trabajar</legend>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {EDUCATION_LEVELS.map((level) => (
              <button type="button" key={level} aria-pressed={hasLevel(level)} onClick={() => toggleLevel(level)} className={`min-h-11 rounded-full border px-3 text-sm font-bold sm:px-4 ${hasLevel(level) ? "border-[#0878be] bg-[#0878be] text-white" : "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>
                {hasLevel(level) ? "✓ " : ""}{level}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-3 md:col-span-2">
          <legend className="text-sm font-bold">Áreas y materias</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <MultiValueField label="Áreas" values={form.areas} placeholder="Ej. Ciencias Sociales" onChange={(areas) => setForm({ ...form, areas })} />
            <MultiValueField label="Materias o espacios" values={form.subjects} placeholder="Ej. Psicología" onChange={(subjects) => setForm({ ...form, subjects })} />
          </div>
        </fieldset>
        <div className="md:col-span-2">
          <MultiValueField label="Cargos / roles" values={form.roles} suggestions={roleOptions} placeholder="Buscá entre cargos publicados por SIME" onChange={(roles) => setForm({ ...form, roles })} />
        </div>
        <fieldset className="space-y-2 md:col-span-2">
          <legend className="text-sm font-bold">Juntas de interés</legend>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {OFFICIAL_JUNTAS.map((item) => {
              const selected = form.boards.some((value) => normalizeJunta(value) === item.id);
              return <button key={item.id} type="button" aria-pressed={selected} onClick={() => toggleBoard(item.id, item.label)} className={`min-h-11 rounded-xl border px-3 text-left text-sm font-bold ${selected ? "border-[#0878be] bg-[#e8f6ff] text-[#075f9b]" : "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>{selected ? "✓ " : ""}{item.label}</button>;
            })}
          </div>
          <p className="text-xs text-[var(--text-muted)]">La junta no se deduce de manera única solo por nivel o cargo, por eso se conserva como elección explícita.</p>
        </fieldset>
        <fieldset className="space-y-2 md:col-span-2">
          <legend className="text-sm font-bold">Circuitos</legend>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {TUCUMAN_CIRCUITS.map((item) => {
              const selected = form.circuits.includes(item.id);
              return <button key={item.id} type="button" aria-pressed={selected} onClick={() => toggleList("circuits", item.id)} className={`min-h-16 rounded-xl border p-3 text-left ${selected ? "border-[#0878be] bg-[#e8f6ff]" : "border-[var(--border)] bg-[var(--surface-secondary)]"}`}>
                <strong className="block text-sm">{selected ? "☑ " : "☐ "}Circuito {item.id}</strong>
                <span className="mt-1 block text-xs text-[var(--text-secondary)]">{item.departments.join(" · ")}</span>
              </button>;
            })}
          </div>
          <p className="text-xs text-[var(--text-muted)]">Podés combinar circuitos. Se conservan preferencias antiguas de departamento/localidad para no alterar datos ni coincidencias ya guardadas.</p>
        </fieldset>
        <MultiValueField label="Turnos" values={form.shifts} placeholder="Ej. Mañana" onChange={(shifts) => setForm({ ...form, shifts })} />
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">Carácter de designación</legend>
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            {OFFICIAL_CHARACTERS.map((item) => (
              <button key={item} type="button" aria-pressed={form.characters.includes(item)} onClick={() => toggleList("characters", item)} className={`min-h-11 rounded-full border px-3 text-sm font-bold ${form.characters.includes(item) ? "border-[#0878be] bg-[#0878be] text-white" : "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--text-secondary)]"}`}>
                {form.characters.includes(item) ? "✓ " : ""}{item}
              </button>
            ))}
          </div>
          <p className="text-xs text-[var(--text-muted)]">Si no elegís ninguno, el carácter no filtra las coincidencias.</p>
        </fieldset>
        <div className="md:col-span-2">
          <MultiValueField label="Capacitaciones de interés" values={form.training_interests} placeholder="Ej. Educación digital" onChange={(training_interests) => setForm({ ...form, training_interests })} />
        </div>
        <label className="space-y-2 md:col-span-2">
          <span className="flex items-center justify-between text-sm font-bold"><span>Umbral de compatibilidad</span><span className="text-[var(--accent-text)]">{form.personal_match_threshold}%</span></span>
          <input aria-label="Umbral de compatibilidad" type="range" min="70" max="100" step="5" value={form.personal_match_threshold} onChange={(event) => setForm({ ...form, personal_match_threshold: Number(event.target.value) })} className="w-full accent-[#0878be]" />
          <span className="block text-xs text-[var(--text-muted)]">Por defecto: 85%. Las fuentes con información desconocida no se descartan automáticamente.</span>
        </label>
        <div className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-center sm:justify-between md:col-span-2">
          <p className="text-xs text-[var(--text-muted)]">Las coincidencias no certifican habilitación legal. Nunca solicitamos tu contraseña de SIME ni de FDCI.</p>
          <Button type="submit" disabled={busy} className="min-h-11 w-full rounded-xl bg-[#0878be] px-6 text-white sm:w-auto">{busy ? "Guardando…" : "Guardar perfil"}</Button>
        </div>
      </form>
    </>
  );
}

function PlatformAccessSection() {
  const platforms = [
    {
      id: "sime",
      name: "SIME",
      description: "Designaciones y servicios docentes.",
      action: "Ingresar a SIME",
      href: SIME_LOGIN,
      image: "/assets/platforms/tucuman-education-emblem.webp",
      imageAlt: "Emblema institucional usado por el portal SIME",
      imageWidth: 256,
      imageHeight: 256,
    },
    {
      id: "fdci",
      name: "Formación Docente Continua",
      description: "Capacitaciones y formación docente.",
      action: "Ingresar a FDCI",
      href: FDCI_LOGIN,
      image: "/assets/platforms/tucuman-education-emblem.webp",
      imageAlt: "Emblema institucional usado por el portal FDCI",
      imageWidth: 256,
      imageHeight: 256,
    },
    {
      id: "infod",
      name: "INFoD / AulaS-TIC",
      description: "Cursos y propuestas de formación nacional.",
      action: "Ingresar a INFoD",
      href: INFOD_LOGIN,
      image: "/assets/platforms/infod-logo.webp",
      imageAlt: "Logotipo oficial del Instituto Nacional de Formación Docente",
      imageWidth: 105,
      imageHeight: 35,
      note: "Ingresás con tus credenciales de INFoD.",
    },
  ];

  return <section className="mx-auto mb-5 w-full max-w-5xl" aria-labelledby="platform-access-title">
    <div className="mb-4">
      <h2 id="platform-access-title" className="text-xl font-black text-[var(--text-primary)]">Plataformas y accesos oficiales</h2>
      <p className="mt-1 text-sm text-[var(--text-secondary)]">Accedé rápidamente a los servicios que utilizás como docente.</p>
    </div>
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {platforms.map((platform) => <article key={platform.id} className="flex min-w-0 flex-col rounded-2xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 text-[var(--text-primary)] sm:p-5">
        <div className="flex min-w-0 items-center gap-3">
          <div className="grid size-14 shrink-0 place-items-center rounded-xl border border-[var(--border)] bg-white p-1.5">
            <Image src={platform.image} alt={platform.imageAlt} width={platform.imageWidth} height={platform.imageHeight} className="h-full w-full object-contain" />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="text-base font-black leading-snug">{platform.name}</h3>
            <p className="mt-1 text-sm leading-snug text-[var(--text-secondary)]">{platform.description}</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex min-h-8 items-center gap-1.5 rounded-full bg-[var(--surface-secondary)] px-3 text-xs font-semibold text-[var(--text-secondary)]"><ExternalLink className="size-3.5" />Sitio externo</span>
          <a href={platform.href} target="_blank" rel="noreferrer" aria-label={`${platform.action} (abre en una pestaña nueva)`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#0878be] px-4 text-sm font-bold text-white hover:bg-[#06659f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0878be]">
            {platform.action} <ExternalLink className="size-4" />
          </a>
        </div>
        {platform.note && <p className="mt-2 text-xs text-[var(--text-muted)]">{platform.note}</p>}
      </article>)}
    </div>
  </section>;
}

function DataDeletionSection({ profile }: { profile: Profile | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supportConfirmed, setSupportConfirmed] = useState(false);
  const requestDeletion = async () => {
    const userId = profile?.user_id;
    if (!userId) { toast.error("No se pudo identificar esta instalación. Escribí a soporte desde la página pública."); return; }
    try {
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId));
      const reference = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 20);
      const subject = encodeURIComponent("Solicitud de eliminación de datos — DocenteTuc");
      const body = encodeURIComponent(`Solicito eliminar mis datos de DocenteTuc.\nReferencia de mi perfil: ${reference}\n\nPor favor, indíquenme cómo verificar la titularidad. No envío contraseñas ni el identificador de mi dispositivo. Entiendo que esta solicitud no borra los datos automáticamente.`);
      window.location.href = `mailto:soporte.docentetuc@gmail.com?subject=${subject}&body=${body}`;
      setOpen(false);
    } catch { toast.error("No se pudo preparar el correo. Usá el enlace a la página pública."); }
  };
  const clearThisDevice = async () => {
    if (!supportConfirmed || !window.confirm("Esto borra la copia local y desvincula esta instalación. Continuá solo si soporte ya confirmó el borrado en D1. ¿Confirmás?")) return;
    try {
      if ("serviceWorker" in navigator) {
        const registration = await navigator.serviceWorker.getRegistration();
        const subscription = await registration?.pushManager?.getSubscription();
        if (subscription) await subscription.unsubscribe();
      }
      for (const key of ["docentetuc-device-id", "docentetuc-data-v1", "docentetuc-theme", "docentetuc-pending-designation", "docentetuc-weather-tucuman-v1"]) localStorage.removeItem(key);
      document.cookie = "sidebar_state=; Max-Age=0; Path=/; SameSite=Lax";
      router.push("/eliminar-datos");
    } catch { toast.error("No se pudo eliminar la suscripción local. Revisá los permisos del navegador e intentá otra vez."); }
  };
  return <section className="mb-5 rounded-3xl border border-[var(--border)] bg-[var(--surface-primary)] p-5 text-[var(--text-primary)] md:p-6" aria-labelledby="data-deletion-title">
    <p className="text-xs font-black uppercase tracking-[.15em] text-[var(--accent-text)]">Privacidad</p>
    <h2 id="data-deletion-title" className="mt-1 text-xl font-black">Eliminar mis datos</h2>
    <p className="mt-2 text-sm text-[var(--text-secondary)]">Podés solicitar el borrado de tus datos personales asociados a DocenteTuc. Como la identidad de instalación no autentica de forma suficiente un borrado remoto, soporte verificará la titularidad antes de ejecutarlo. No es automático.</p>
    <div className="mt-4 flex flex-wrap gap-3"><Button type="button" onClick={() => setOpen(true)} className="min-h-11 rounded-xl bg-[#075f9b] text-white">Eliminar mis datos</Button><a href="/eliminar-datos" className="inline-flex min-h-11 items-center rounded-xl border border-[var(--border)] px-4 text-sm font-bold text-[var(--accent-text)]">Cómo funciona la eliminación</a></div>
    <div className="mt-5 border-t border-[var(--border)] pt-4"><label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={supportConfirmed} onChange={(event) => setSupportConfirmed(event.target.checked)} className="mt-1" /><span>Soporte ya me confirmó que eliminó mis datos del servidor. Quiero borrar la copia de este dispositivo.</span></label><Button type="button" variant="outline" disabled={!supportConfirmed} onClick={() => void clearThisDevice()} className="mt-3 min-h-11 rounded-xl">Borrar datos locales</Button></div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto"><DialogHeader><DialogTitle>Solicitar eliminación de mis datos</DialogTitle><DialogDescription>Revisá el alcance antes de abrir tu correo. No se borrará nada sólo por pulsar este botón.</DialogDescription></DialogHeader>
      <div className="space-y-3 text-sm text-[var(--text-secondary)]"><p>Tras verificar tu titularidad, soporte eliminará de D1:</p><ul className="list-disc space-y-1 pl-5"><li>perfil docente privado y perfil público (nombre visible, avatar y bio), además de preferencias, cargos, circuitos e intereses;</li><li>guardados, agenda, seguimiento de designaciones y recordatorios;</li><li>notificaciones, suscripciones y preferencias push, entregas y límites técnicos de uso.</li></ul><p>Se conservan las publicaciones y documentos públicos de fuentes educativas, los datos de otros usuarios y las cuentas externas de SIME/FDCI. Los correos de soporte se tratarán por separado y se conservarán sólo mientras sean necesarios para tramitar la solicitud.</p><p>No borres todavía el identificador local: es necesario para localizar tus datos. El correo incluirá una referencia que no sirve para ingresar a tu perfil.</p></div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setOpen(false)}>Cancelar</Button><Button type="button" onClick={() => void requestDeletion()} className="bg-[#075f9b] text-white">Confirmo y redacto la solicitud</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
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

function PushSettings({ profile }: { profile: Profile | null }) {
  const [available, setAvailable] = useState(true), [subscribed, setSubscribed] = useState(false), [permission, setPermission] = useState<NotificationPermission>("default"), [busy, setBusy] = useState(false), [preferences, setPreferences] = useState(defaultPushPreferences);
  const [smartTrainingAlerts, setSmartTrainingAlerts] = useState(Boolean(profile?.notify_new_trainings)), [trainingThreshold, setTrainingThreshold] = useState(profile?.training_match_threshold || 80);
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
  const saveSmartTrainingAlerts = async () => { setBusy(true); try { const response = await fetch("/api/app", { method: "POST", headers: apiHeaders(true), body: JSON.stringify({ action: "set_training_alert_preferences", enabled: smartTrainingAlerts, threshold: trainingThreshold }) }); if (!response.ok) throw new Error(); toast.success("Alertas automáticas actualizadas"); } catch { toast.error("No se pudieron guardar las alertas automáticas"); } finally { setBusy(false); } };
  const blocked = !supported || !available || permission === "denied", active = permission === "granted" && subscribed;
  const status = active ? "Activadas" : blocked ? "Bloqueadas" : "Pendientes";
  const toggle = (key: keyof PushPreferenceState, label: string) => <label className="flex items-center justify-between gap-4 rounded-xl border border-[var(--border)] bg-white p-3"><span className="text-sm font-semibold">{label}</span><Switch checked={Boolean(preferences[key])} onCheckedChange={(checked) => setPreferences({ ...preferences, [key]: checked })} disabled={!active || busy} /></label>;
  return <section className="push-settings mt-5 rounded-3xl border p-5 md:p-7">
    <div className="flex flex-wrap items-start justify-between gap-4"><div className="max-w-2xl"><p className="text-xs font-black uppercase tracking-[.16em] text-[var(--accent-text)]">Alertas en tu celular</p><h2 className="mt-2 text-xl font-black text-[var(--text-primary)]">Recibí novedades aunque DocenteTuc esté cerrada</h2><p className="mt-2 text-sm leading-relaxed text-[var(--text-muted)]">Al activar, el navegador pedirá permiso una sola vez. Guardamos una suscripción técnica de este dispositivo, nunca contraseñas de SIME o FDCI. Podés desactivarla cuando quieras.</p></div><Badge className={active ? "badge-success" : blocked ? "badge-danger" : "badge-warning"}>{status}</Badge></div>
    <div className="mt-5 flex flex-wrap gap-3">{active ? <><Button type="button" onClick={() => void test()} disabled={busy} className="rounded-xl bg-[#0878be] text-white"><Bell className="size-4" />Enviar prueba</Button><Button type="button" variant="outline" onClick={() => void deactivate()} disabled={busy} className="rounded-xl bg-white">Desactivar en este dispositivo</Button></> : <Button type="button" onClick={() => void activate()} disabled={busy || blocked} className="rounded-xl bg-[#0878be] text-white"><Bell className="size-4" />Activar alertas</Button>}</div>
    {blocked && <p className="mt-3 rounded-xl bg-[#fff0ec] p-3 text-sm font-semibold text-[#8b3a2d]">{permission === "denied" ? "El navegador bloqueó los avisos. Abrí la configuración del sitio, permití Notificaciones y volvé a esta pantalla." : "Este navegador o la configuración del servidor no admite Web Push."}</p>}
    <div className="mt-6 grid gap-3 md:grid-cols-2">{toggle("vacancies", "Nueva designación compatible")}{toggle("designationRoles", "Nuevo cargo de interés")}{toggle("designationExact", "Coincidencia exacta")}{toggle("designationPartial", "Coincidencia parcial")}{toggle("dateChanges", "Cambio de fecha o estado")}{toggle("trainings", "Capacitaciones compatibles")}{toggle("commissions", "Nuevas comisiones")}{toggle("reminders", "Aperturas y recordatorios")}{toggle("closingSoon", "Cierres próximos")}{toggle("boards", "Padrones y comunicados")}</div>
    <div className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--surface-secondary)] p-4"><label className="flex items-center justify-between gap-4"><span><strong className="block text-[var(--text-primary)]">Avisarme automáticamente de capacitaciones muy compatibles</strong><small className="text-[var(--text-muted)]">Sólo para inscripciones que abren dentro de 14 días.</small></span><Switch checked={smartTrainingAlerts} onCheckedChange={setSmartTrainingAlerts} /></label><label className="mt-4 block text-sm font-semibold text-[var(--text-secondary)]">Compatibilidad mínima: {trainingThreshold}%<Input aria-label="Compatibilidad mínima" type="range" min="50" max="100" step="5" value={trainingThreshold} onChange={(event) => setTrainingThreshold(Number(event.target.value))} className="mt-2 h-8" /></label><Button type="button" variant="outline" onClick={() => void saveSmartTrainingAlerts()} disabled={busy} className="mt-3 h-10 rounded-xl bg-white">Guardar alerta automática</Button></div>
    <div className="mt-4 flex flex-wrap items-end gap-3"><label className="text-sm font-semibold text-[var(--text-secondary)]">Silenciar desde<Input type="time" value={preferences.quietStart} onChange={(event) => setPreferences({ ...preferences, quietStart: event.target.value })} disabled={!active} className="mt-1 h-10 w-36 bg-white" /></label><label className="text-sm font-semibold text-[var(--text-secondary)]">Hasta<Input type="time" value={preferences.quietEnd} onChange={(event) => setPreferences({ ...preferences, quietEnd: event.target.value })} disabled={!active} className="mt-1 h-10 w-36 bg-white" /></label><Button type="button" variant="outline" onClick={() => void save()} disabled={!active || busy} className="h-10 rounded-xl bg-white">Guardar preferencias</Button></div>
  </section>;
}

function PublicationSheet({ publication, saved, tracking, match, onClose, onAskAI, onSave, onAgenda, onSchedule, onFollow, onExternal, onEditDesignation }: { publication: Publication | null; saved?: Saved; tracking?: DesignationTracking; match: MatchResult | null; onClose: () => void; onAskAI: (item: Publication) => void; onSave: (item: Publication, enabled: boolean) => void; onAgenda: (item: Publication, enabled: boolean) => void; onSchedule: (item: Publication) => void; onFollow: (item: Publication, enabled: boolean) => void; onExternal: (item: Publication) => void; onEditDesignation: (item: Publication) => void }) {
  void onSchedule;
  const training = publication?.kind === "capacitacion" ? parseTrainingMetadata(publication.metadata) : null;
  const trainingState = publication?.kind === "capacitacion" ? enrollmentForUI(publication) : null;
  const info = publication?.kind === "informacion" ? usefulMetadata(publication.metadata) : null;
  const lifecycle = publication ? publicationLifecycleForUI(publication) : "UNKNOWN";
  const documentMetadata = publication?.kind === "junta" ? (() => { try { return JSON.parse(publication.metadata) as { contentAvailable?: boolean; format?: string; itemCount?: number }; } catch { return {}; } })() : null;
  const facts: [string, string | number | undefined | null][] = publication ? publication.kind === "informacion" ? [
    ["Tipo", info?.recordType === "procedure" ? "Trámite" : info?.recordType === "system" ? "Sistema" : "Organismo"], ["Dirección", info?.address], ["Horario", info?.openingHours], ["Organismo", info?.parentOrganization]
  ] : publication.kind === "vacante" ? [
    ["Código de trámite SIME", simeCodeForPublication(publication) || "No informado"], ["Junta", publication.junta || publication.level || "No informada por SIME"], ["Carácter", publication.character || "No informado por SIME"],
    ["Fecha de publicación", publication.starts_at ? dateLabel(publication.starts_at, true) : "No informada por SIME"], ["Fecha de cierre", publication.ends_at ? dateLabel(publication.ends_at, true) : "No informada por SIME"],
    ["Circuito", publication.circuit && publication.circuit !== "UNKNOWN" ? `${publication.circuit}${publication.circuit_confidence != null ? ` · confianza ${publication.circuit_confidence}%` : ""}` : "No recuperado del listado sincronizado; verificar en ficha oficial SIME"],
    ["Turno", publication.shift || "No informado por SIME"], ["Localidad", publication.location || "No informada por SIME"], ["Estado en DocenteTuc", lifecycleLabel(lifecycle)]
  ] : publication.kind === "capacitacion" ? [
    ["Estado de inscripción", enrollmentLabel(publication)], ["Fuente", training?.source || publication.source], ["Fecha publicada por la fuente", publication.source_published_at || null], ["Estado de fechas", training?.dateStatus === "tentative" ? "Tentativas según la fuente" : training?.dateStatus === "general_window" ? "Ventana general, no específica del curso" : training?.dateStatus === "course_confirmed" ? "Confirmadas para este curso" : training?.dateStatus === "confirmed" ? "Confirmadas por la fuente" : "Fecha no confirmada"], ["Comisión", training?.commissionId], ["Nivel", publication.level], ["Área", publication.area], ["Modalidad", publication.character],
    ["Inicio", publication.starts_at ? dateLabel(publication.starts_at) : null], ["Finalización", training?.courseEndsAt ? dateLabel(training.courseEndsAt) : null],
    ["Apertura de inscripción", training?.registrationOpensAt ? dateLabel(training.registrationOpensAt, true) : null], ["Cierre de inscripción", training?.registrationClosesAt ? dateLabel(training.registrationClosesAt, true) : null],
    ["Lugar", publication.location], ["Dirección", training?.address], ["Cupo", training?.capacity], ["Cupo de preinscripción", training?.preCapacity],
    ["Carga horaria", training?.hours != null ? `${training.hours} horas cátedra` : null], ["Encuentros", training?.meetings], ["Institución", training?.organization],
  ] : [["Estado en DocenteTuc", lifecycleLabel(lifecycle)], ["Estado informado por la fuente", publication.status], ["Publicada / actualizada por origen", publication.source_published_at || null], ["Circuito inferido", publication.circuit && publication.circuit !== "UNKNOWN" ? `${publication.circuit}${publication.circuit_confidence != null ? ` · confianza ${publication.circuit_confidence}%` : ""}` : "Desconocido"], ["Nivel / Junta", publication.level || publication.junta], ["Carácter / modalidad", publication.character], ["Turno", publication.shift], ["Lugar", publication.location], ["Cierre", publication.ends_at ? dateLabel(publication.ends_at, true) : null]] : [];
  const insufficient = Boolean(match && (match.confidence < 70 || (match.criteria.length > 0 && match.criteria.every((criterion) => !criterion.available))));
  const criteriaView = match?.criteria.map((criterion) => <div key={criterion.key} className="flex gap-3 text-sm">
    <span className={criterion.outcome === "MATCH" ? "text-[#277044]" : criterion.outcome === "NO_MATCH" ? "text-[#b44b3f]" : "text-[#71879a]"}>{criterion.outcome === "MATCH" ? "✓" : criterion.outcome === "NO_MATCH" ? "✕" : "—"}</span>
    <span><strong>{criterion.label}:</strong> {criterion.expected}{!criterion.available && " (la publicación no informa este dato)"}{criterion.outcome === "NO_MATCH" && " (no coincide)"}</span>
  </div>);
  return (
    <Sheet modal={false} open={Boolean(publication)} onOpenChange={(open) => !open && onClose()}>
      <SheetContent showOverlay={false} onInteractOutside={(event) => event.preventDefault()} className="app-detail-surface w-full overflow-y-auto border-l-[#dce8e1] p-0 sm:max-w-xl">
        <SheetHeader className="border-b border-[#dce8e1] bg-white p-6 pr-12">
          <div className="mb-2 flex flex-wrap gap-2">
            <Badge className="bg-[#edf4ef] text-[#356053]">{publication ? publicationLabel(publication) : "Publicación"}</Badge>
            {publication && <Badge className={lifecycle === "ACTIVE" ? "badge-success" : lifecycle === "UPCOMING" ? "badge-info" : "badge-warning"}>{lifecycleLabel(lifecycle)}</Badge>}
            {documentMetadata?.contentAvailable && <Badge className="badge-info">Contenido disponible</Badge>}
            {tracking && <Badge className="badge-info">{tracking.status}</Badge>}
            {match && publication?.kind !== "informacion" && <MatchBadge result={match} />}
          </div>
          <SheetTitle className="text-left text-2xl leading-tight text-[#17362d]">{publication?.title}</SheetTitle>
          <SheetDescription className="text-left">Fuente oficial: {publication?.source || ""}</SheetDescription>
        </SheetHeader>
        {publication && <div className="space-y-5 p-5 pb-24 md:p-6 md:pb-24">
          <Button onClick={() => onAskAI(publication)} className="h-11 w-full rounded-xl bg-[#0878be] text-white"><Sparkles className="size-4" />Preguntar a IA sobre esta información</Button>
          <div className="grid grid-cols-2 gap-3">{facts.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => <div key={label} className="rounded-2xl border border-[#dce8e1] bg-white p-4"><p className="text-xs font-bold uppercase tracking-wide text-[#80938c]">{label}</p><p className="mt-1 font-semibold">{value}</p></div>)}</div>
          <div className="rounded-2xl border border-[#dce8e1] bg-white p-5">
            <h3 className="font-bold">{publication.kind === "junta" ? "Contenido disponible en DocenteTuc" : publication.kind === "vacante" ? "Datos publicados por SIME" : "Descripción"}</h3>
            <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{publication.summary || "No fue informada por la fuente oficial."}</p>
          </div>
          {info && <>
            <InfoList title="Servicios y trámites" values={info.services} />
            <InfoList title="Documentación / requisitos publicados" values={info.requirements || info.documents} />
            <InfoList title="Teléfonos" values={info.phones} />
            <InfoList title="Correos" values={info.emails} />
            {(info.notes || info.discrepancy) && <div className="rounded-2xl border border-[#ead6b8] bg-[#fff8e9] p-4 text-sm leading-relaxed text-[#72501d]">{info.notes && <p>{info.notes}</p>}{info.discrepancy && <p className={info.notes ? "mt-2" : ""}><strong>Discrepancia registrada:</strong> {info.discrepancy}</p>}</div>}
            <div className="grid grid-cols-2 gap-2">
              {info.phones?.[0] && <a href={`tel:${info.phones[0].replace(/[^+\\d]/g, "")}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border bg-white font-bold"><Phone className="size-4" />Llamar</a>}
              {info.emails?.[0] && <a href={`mailto:${info.emails[0]}`} className="flex h-11 items-center justify-center gap-2 rounded-xl border bg-white font-bold"><Mail className="size-4" />Correo</a>}
              {info.address && <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(info.address)}`} target="_blank" rel="noreferrer" className="flex h-11 items-center justify-center gap-2 rounded-xl border bg-white font-bold"><MapPin className="size-4" />Cómo llegar</a>}
            </div>
          </>}
          {training?.recipients && <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Destinatarios</h3><p className="mt-2 text-sm leading-relaxed text-[#5f756d]">{training.recipients}</p></div>}
          {training?.content && <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Contenidos</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{training.content}</p></div>}
          {training?.schedule && <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">Cronograma</h3><p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-[#5f756d]">{training.schedule}</p></div>}
          {match && publication.kind !== "informacion" && match.status !== "unconfigured" && <div className="rounded-2xl border border-[#c8e1f1] bg-white p-5">
            {insufficient
              ? <><h3 className="font-black">Compatibilidad con tu perfil</h3><p className="mt-2 text-sm text-[#52708c]">Compatibilidad: no determinada. Confianza: baja ({match.confidence}%). Se conocen {match.criteria.filter((criterion) => criterion.available).length} de {match.total} criterios seleccionados, por lo que no mostramos un porcentaje de compatibilidad.</p></>
              : <><div className="flex items-center justify-between gap-3"><div><h3 className="font-black">¿Por qué coincide?</h3><p className="mt-1 text-sm text-[#52708c]">Compatibilidad: {match.score}% · confianza: {match.confidence}% · {match.matched} de {match.total} criterios coinciden.</p></div></div></>}
            <div className="mt-4 space-y-2">{criteriaView}</div>
          </div>}
          <div className="grid gap-2 sm:grid-cols-2">
            <Button variant={saved ? "default" : "outline"} onClick={() => onSave(publication, !saved)} className="h-11 rounded-xl"><Star className={`size-4 ${saved ? "fill-current" : ""}`} />{saved ? (publication.kind === "informacion" ? "Contacto guardado" : "Guardada") : (publication.kind === "informacion" ? "Guardar contacto" : "Guardar")}</Button>
            {publication.kind !== "informacion" && <Button variant={Boolean(saved?.in_agenda) ? "default" : "outline"} onClick={() => onAgenda(publication, !Boolean(saved?.in_agenda))} className="h-11 rounded-xl"><CalendarDays className="size-4" />{Boolean(saved?.in_agenda) ? "Quitar de mi agenda" : "Agregar a mi agenda"}</Button>}
            {(publication.kind === "junta" || publication.kind === "vacante") && <Button variant={Boolean(saved?.followed) ? "default" : "outline"} onClick={() => onFollow(publication, !Boolean(saved?.followed))} className="h-11 rounded-xl"><Bell className="size-4" />{Boolean(saved?.followed) ? "Dejar de seguir" : "Seguir"}</Button>}
            {publication.kind === "vacante" && tracking && <Button variant="outline" onClick={() => onEditDesignation(publication)} className="h-11 rounded-xl">Editar seguimiento</Button>}
          </div>
          {publication.kind === "vacante"
            ? <Button type="button" onClick={() => onExternal(publication)} className="min-h-12 w-full rounded-xl bg-[#17362d] px-5 text-white">Inscribirme en sitio oficial <ExternalLink className="size-4" /></Button>
            : <a href={publication.official_url} target="_blank" rel="noreferrer" className="flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#17362d] px-5 text-center font-bold text-white">{publication.kind === "capacitacion" ? trainingState === "ABIERTA" && training?.commissionId ? "CONTINUAR INSCRIPCIÓN EN SITIO OFICIAL" : "Ver detalle en sitio oficial" : publication.kind === "informacion" && info?.access === "private" ? "Abrir sistema oficial" : "Abrir fuente oficial"} <ExternalLink className="size-4" /></a>}
          <p className="rounded-xl bg-[#fff3dd] p-4 text-sm leading-relaxed text-[#7d541b]">{publication.kind === "vacante" ? "DocenteTuc organiza información pública. Abrir el sitio oficial no marca una inscripción; el estado sólo cambia cuando vos lo confirmás." : publication.kind === "junta" ? "DocenteTuc muestra el contenido público recuperable. Para archivos PDF o carpetas sin texto exportable, la fuente oficial conserva el documento completo." : publication.kind === "informacion" ? `Información oficial verificada el ${info?.lastVerified || "día no informado"}. DocenteTuc nunca solicita credenciales de sistemas gubernamentales.` : "La inscripción y cualquier gestión se completan siempre en el sitio oficial."}</p>
        </div>}
      </SheetContent>
    </Sheet>
  );
}

function InfoList({ title, values }: { title: string; values?: string[] }) { return <div className="rounded-2xl border border-[#dce8e1] bg-white p-5"><h3 className="font-bold">{title}</h3>{values?.length ? <ul className="mt-2 space-y-2 text-sm leading-relaxed text-[#5f756d]">{values.map((value) => <li key={value} className="flex gap-2"><span className="text-[#0878be]">✓</span><span>{value}</span></li>)}</ul> : <p className="mt-2 text-sm text-[#5f756d]">No publicado en la fuente consultada.</p>}</div>; }

function Empty({ title, text }: { title: string; text: string }) { return <EmptyState title={title} text={text} className="min-h-64 rounded-2xl" />; }
function LoadingCards() { return <div className="grid gap-4 md:grid-cols-2">{[1, 2, 3, 4].map((item) => <div key={item} className="h-52 animate-pulse rounded-3xl border border-[#dce8e1] bg-white p-5"><div className="h-5 w-24 rounded bg-[#e8efeb]" /><div className="mt-8 h-6 w-4/5 rounded bg-[#e8efeb]" /><div className="mt-3 h-4 w-full rounded bg-[#eef3f0]" /></div>)}</div>; }

declare global { interface Document { readonly modelContext?: { registerTool(tool: { name: string; title?: string; description: string; inputSchema: object; annotations?: { readOnlyHint?: boolean; untrustedContentHint?: boolean }; execute(input: unknown): unknown | Promise<unknown> }, options?: { signal?: AbortSignal }): void | Promise<void> } } }
