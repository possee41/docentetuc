export const appViews = ["inicio", "busqueda", "noticias", "vacantes", "actos", "llamados", "comunidad", "capacitaciones", "junta", "padrones", "comunicados", "informacion", "agenda", "alertas", "guardados", "perfil", "cuentas"] as const;
export type AppView = typeof appViews[number];

export const viewFromSection = (section?: string | null): AppView => appViews.includes(section as AppView) ? section as AppView : "inicio";
export const sectionUrl = (view: AppView) => view === "inicio" ? "/" : view === "comunidad" ? "/comunidad" : `/?section=${view}`;
export const shouldRevalidateAccount = (previous: AppView | null, current: AppView, hasLoadError: boolean, inFlight: boolean) =>
  previous !== null && previous !== "cuentas" && current === "cuentas" && hasLoadError && !inFlight;
