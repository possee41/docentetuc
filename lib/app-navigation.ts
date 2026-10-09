export const appViews = ["inicio", "vacantes", "comunidad", "capacitaciones", "junta", "informacion", "agenda", "alertas", "guardados", "perfil", "cuentas"] as const;
export type AppView = typeof appViews[number];

export const viewFromSection = (section?: string | null): AppView => appViews.includes(section as AppView) ? section as AppView : "inicio";
export const sectionUrl = (view: AppView) => view === "inicio" ? "/" : view === "comunidad" ? "/comunidad" : `/?section=${view}`;
