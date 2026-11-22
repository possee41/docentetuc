import { OFFICIAL_JUNTAS, type JuntaId } from "./juntas.ts";
import type { BoardView } from "./board-view.ts";
import { PUBLICATION_VISIBILITY_SQL } from "./publication-visibility.ts";

export const BOARD_PAGE_SIZE = 50;
// Keep each response bounded; the client still collects all pages for grouping.
export const PADRON_PAGE_SIZE = 50;
export const PADRON_MAX_PAGES = Math.ceil(20_000 / PADRON_PAGE_SIZE);
export type BoardPageView = Extract<BoardView, "padrones" | "comunicados" | "llamados">;
export type BoardPageMode = "current" | "references";

export function boardCursorBinds(view: BoardPageView, cursor: string) {
  if (view !== "comunicados") return [cursor];
  if (!cursor) return [0, "", "", ""];
  const value = JSON.parse(cursor);
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== "string" ||
    value[0] !== "" && !/^\d{4}-\d{2}-\d{2}(?:T[^|]{1,30})?$/.test(value[0]) ||
    typeof value[1] !== "string" || !/^[A-Za-z0-9:_-]{1,240}$/.test(value[1])) throw Error("BOARD_CURSOR_INVALID");
  return [1, value[0], value[0], value[1]];
}
export function nextBoardCursor(view: BoardPageView, row: { id: string; source_published_at?: string | null }) {
  return view === "comunicados" ? JSON.stringify([row.source_published_at || "", row.id]) : row.id;
}

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
  const entity = view === "padrones" ? "padron" : "opportunity";
  const conditions = ["source='Padrones y Comunicados'", "kind='junta'", "id>?", "removed_at IS NULL"];
  if(view!=="llamados")conditions.push(PUBLICATION_VISIBILITY_SQL);
  const binds: string[] = [];
  if (view === "comunicados") conditions[2] = "(?=0 OR coalesce(source_published_at,'')<? OR (coalesce(source_published_at,'')=? AND id>?))";
  if (view === "llamados" && mode === "references") {
    conditions.push("category='Llamados abiertos'");
  } else {
    conditions.push(view === "comunicados"
      ? "(id LIKE 'notice:%' AND json_valid(metadata) AND json_extract(metadata,'$.official.sourceCategory')='Comunicados' AND coalesce(json_extract(metadata,'$.official.canonicalId'),'')='')"
      : view === "padrones"
      ? "(category='Padrones' OR title LIKE '%padron%' OR title LIKE '%padrón%' OR CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.entity')='padron' ELSE 0 END)"
      : `(category='${category}' OR (json_valid(metadata) AND json_extract(metadata,'$.official.entity')='${entity}'))`);
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
  return { sql: `SELECT * FROM publications WHERE ${conditions.join(" AND ")} ORDER BY ${view === "comunicados" ? "coalesce(source_published_at,'') DESC," : ""}id LIMIT ${(view === "padrones" ? PADRON_PAGE_SIZE : BOARD_PAGE_SIZE) + 1}`,
    binds, needsNow: view === "llamados" && mode === "current" };
}
