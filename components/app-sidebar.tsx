"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { BookOpen, Bookmark, BriefcaseBusiness, Building2, CalendarDays, CircleUserRound, GraduationCap, Home, Menu, MessagesSquare, PanelLeftClose, Pin, Search, UserRound, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { Sidebar, SidebarContent, SidebarFooter, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import { sidebarIsOpen, updateSidebarVisibility } from "@/lib/sidebar-visibility";
import type { SidebarVisibility } from "@/lib/sidebar-visibility";
import { sectionUrl } from "@/lib/app-navigation";
import type { AppView } from "@/lib/app-navigation";

export type { AppView } from "@/lib/app-navigation";

export const navigation: [AppView, string, LucideIcon][] = [
  ["inicio", "Inicio", Home], ["busqueda", "Buscar", Search], ["vacantes", "Inscripciones SIME", BriefcaseBusiness], ["actos", "Actos de designación", CalendarDays], ["llamados", "Llamados abiertos", BriefcaseBusiness], ["comunidad", "Comunidad", MessagesSquare], ["capacitaciones", "Capacitaciones", GraduationCap],
  ["junta", "Consultas oficiales", BookOpen], ["padrones", "Padrones", BookOpen], ["comunicados", "Comunicados", MessagesSquare], ["informacion", "Información útil", Building2], ["agenda", "Agenda", CalendarDays], ["guardados", "Mis guardados", Bookmark], ["perfil", "Perfil docente", UserRound], ["cuentas", "Cuentas y accesos", CircleUserRound],
];

const groups: [string, AppView[]][] = [["Uso diario", ["inicio", "busqueda", "vacantes", "actos", "llamados", "comunidad", "capacitaciones", "agenda"]], ["Consultas", ["padrones", "comunicados", "informacion"]], ["Personal", ["perfil", "guardados", "cuentas"]]];

export function useAppSidebarState(defaultPinned: boolean) {
  const [visibility, setVisibility] = useState<SidebarVisibility>({ pinned: defaultPinned, hovered: false });
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  useEffect(() => cancelClose, [cancelClose]);
  const enter = useCallback(() => {
    cancelClose();
    setVisibility((current) => updateSidebarVisibility(current, { type: "hover-enter" }));
  }, [cancelClose]);
  const leave = useCallback(() => {
    cancelClose();
    closeTimer.current = setTimeout(() => setVisibility((current) => updateSidebarVisibility(current, { type: "hover-leave" })), 120);
  }, [cancelClose]);
  const togglePin = useCallback(() => {
    cancelClose();
    setVisibility((current) => updateSidebarVisibility(current, { type: "toggle-pin" }));
  }, [cancelClose]);
  const onOpenChange = useCallback((open: boolean) => {
    cancelClose();
    setVisibility((current) => updateSidebarVisibility(current, { type: "set-open", open }));
  }, [cancelClose]);
  return { ...visibility, open: sidebarIsOpen(visibility), enter, leave, togglePin, onOpenChange };
}

export function AppSidebarEdge({ pinned, onEnter, onLeave }: { pinned: boolean; onEnter: () => void; onLeave: () => void }) {
  return pinned ? null : <div aria-hidden="true" className="dt-sidebar-edge" onMouseEnter={onEnter} onMouseLeave={onLeave} />;
}

export function AppSidebarTrigger({ pinned, open, onTogglePin }: { pinned: boolean; open: boolean; onTogglePin: () => void }) {
  const { openMobile, setOpenMobile } = useSidebar();
  return <>
    <button type="button" onClick={() => setOpenMobile(!openMobile)} aria-label={openMobile ? "Cerrar menú" : "Abrir menú"} aria-expanded={openMobile} className="inline-flex size-11 shrink-0 items-center justify-center rounded-xl bg-white text-[#062b55] md:hidden"><Menu className="size-5" /></button>
    <button type="button" onClick={onTogglePin} aria-label={pinned ? "Cerrar menú lateral" : "Fijar menú lateral abierto"} aria-expanded={open} aria-pressed={pinned} className="hidden size-11 shrink-0 items-center justify-center rounded-xl border border-[#dce8e1] bg-white text-[#062b55] hover:bg-[#edf6fc] md:inline-flex"><Menu className="size-5" /></button>
  </>;
}

export function AppSidebar({ view, onNavigate, pinned, onTogglePin, onHoverEnter, onHoverLeave }: {
  view: AppView;
  onNavigate?: (view: AppView) => void;
  pinned: boolean;
  onTogglePin: () => void;
  onHoverEnter: () => void;
  onHoverLeave: () => void;
}) {
  const router = useRouter();
  const { isMobile, setOpenMobile } = useSidebar();
  const navigate = (target: AppView) => {
    setOpenMobile(false);
    if (onNavigate) onNavigate(target);
    else router.push(sectionUrl(target));
  };
  return <Sidebar collapsible="offcanvas" className="z-40 border-r border-white/10 text-white backdrop-blur-xl" onMouseEnter={isMobile ? undefined : onHoverEnter} onMouseLeave={isMobile ? undefined : onHoverLeave}>
    <SidebarHeader className="p-5 pt-[max(1.25rem,env(safe-area-inset-top))]">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate("inicio")} className="flex min-w-0 flex-1 items-center gap-3 text-left"><Image src="/icon-192.png" alt="" width={48} height={48} unoptimized className="size-12 rounded-2xl shadow-sm" /><span><span className="block text-xl font-black">DocenteTuc</span><span className="block text-xs text-white/55">Información docente</span></span></button>
        <button type="button" onClick={onTogglePin} aria-label={pinned ? "Cerrar menú lateral" : "Fijar menú lateral abierto"} aria-pressed={pinned} className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/15 md:inline-flex">{pinned ? <PanelLeftClose className="size-5" /> : <Pin className="size-5" />}</button>
        <button type="button" onClick={() => setOpenMobile(false)} aria-label="Cerrar menú" className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-white/80 hover:bg-white/15 md:hidden"><X className="size-5" /></button>
      </div>
    </SidebarHeader>
    <SidebarContent className="px-3"><SidebarMenu>{groups.map(([group, ids]) => <div key={group} className="mb-4"><p className="px-3 pb-1 text-[10px] font-black uppercase tracking-[.16em] text-white/45">{group}</p>{ids.map((id) => { const [, label, Icon] = navigation.find(([itemId]) => itemId === id)!; return <SidebarMenuItem key={id} className={["inicio", "comunidad", "agenda", "perfil", "cuentas"].includes(id) ? "max-md:hidden" : undefined}><SidebarMenuButton isActive={view === id} onClick={() => navigate(id)} className="h-10 rounded-xl bg-white/8 px-3 font-semibold text-white hover:bg-white/15 hover:text-white data-[active=true]:bg-[#2eb6f3] data-[active=true]:font-black data-[active=true]:text-white"><Icon className="size-5" /><span>{label}</span></SidebarMenuButton></SidebarMenuItem>; })}</div>)}</SidebarMenu></SidebarContent>
    <SidebarFooter className="p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]"><p className="text-xs leading-relaxed text-white/45">Herramienta independiente. La fuente oficial prevalece siempre.</p></SidebarFooter>
  </Sidebar>;
}
