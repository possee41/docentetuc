import { OFFICIAL_JUNTAS, type JuntaId } from "./juntas.ts";
import type { BoardView } from "./board-view.ts";
import { PUBLICATION_VISIBILITY_SQL } from "./publication-visibility.ts";

export const BOARD_PAGE_SIZE = 50;
// Padrones needs the whole list to group and rank it, so it ships in larger pages.
export const PADRON_PAGE_SIZE = 200;
export type BoardPageView = Extract<BoardView, "padrones" | "comunicados" | "llamados">;
export type BoardPageMode = "current" | "references";

const juntaTerms: Record<JuntaId, string[]> = {
  "inicial-primaria": ["inicial", "primaria"],
  secundaria: ["secundaria", "secundario"],
  tecnica: ["técnica", "tecnica", "agrotécnica", "agrotecnica", "no formal", "etp"],
  "superior-especial-artistica": ["superior", "especial", "artística", "artistica"],
};

export function boardPageQuery(view: BoardPageView, junta: JuntaId | "todas", mode: BoardPageMode = "current", search = "") {
  if (!["padrones", "comunicados", "llamados"].includes(view) ||
      junta !== "todas" && !OFFICIAL_JUNTAS.some((item) => item.id === junta) ||
      !["current", "references"].includes(mode)) throw new Error("BOARD_FILTER_INVALID");
  const category = view === "padrones" ? "Padrones" : view === "comunicados" ? "Comunicados" : "Llamados abiertos";
  const entity = view === "padrones" ? "padron" : view === "comunicados" ? "notice" : "opportunity";
  const conditions = ["source='Padrones y Comunicados'", "kind='junta'", "id>?", "removed_at IS NULL", PUBLICATION_VISIBILITY_SQL];
  const binds: string[] = [];
  if (view === "llamados" && mode === "references") {
    conditions.push("category='Llamados abiertos'");
  } else {
    conditions.push(view === "padrones"
      ? "(category='Padrones' OR title LIKE '%padron%' OR title LIKE '%padrón%' OR CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.entity')='padron' ELSE 0 END)"
      : `(category='${category}' OR CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.entity')='${entity}' ELSE 0 END)`);
    if (view === "llamados") conditions.push("(registration_close_at>=? OR ends_at>=?)");
  }
  if (junta !== "todas") {
    const terms = juntaTerms[junta];
    const fields = "lower(coalesce(junta,'') || ' ' || coalesce(level,''))";
    conditions.push(`(${terms.map(() => `${fields} LIKE ?`).join(" OR ")})`);
    binds.push(...terms.map((term) => `%${term}%`));
  }
  if (search) {
    conditions.push("(title LIKE ? OR summary LIKE ?)");
    binds.push(`%${search}%`, `%${search}%`);
  }
  return { sql: `SELECT * FROM publications WHERE ${conditions.join(" AND ")} ORDER BY id LIMIT ${(view === "padrones" ? PADRON_PAGE_SIZE : BOARD_PAGE_SIZE) + 1}`,
    binds, needsNow: view === "llamados" && mode === "current" };
}
