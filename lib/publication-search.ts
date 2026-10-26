export const PUBLICATION_SEARCH_PAGE_SIZE = 20;
export const PUBLICATION_SEARCH_KINDS = ["all", "vacante", "capacitacion", "junta", "informacion"] as const;
export type PublicationSearchKind = typeof PUBLICATION_SEARCH_KINDS[number];

type CursorRow = { updated_at: string; id: string };

export function searchCursor(row: CursorRow) {
  return JSON.stringify([row.updated_at, row.id]);
}

const textFields = ["title", "summary", "source", "category", "level", "area", "junta", "location", "character", "source_circuit_raw"];
const officialScope = `CASE WHEN json_valid(metadata) THEN coalesce(json_extract(metadata, '$.official.scope.school'), '') || ' ' || coalesce(json_extract(metadata, '$.official.scope.subject'), '') || ' ' || coalesce(json_extract(metadata, '$.official.scope.role'), '') ELSE '' END`;
const searchableText = `(${[...textFields.map(field => `coalesce(${field}, '')`), officialScope].join(" || ' ' || ")})`;
const accentPairs = [["á", "a"], ["é", "e"], ["í", "i"], ["ó", "o"], ["ú", "u"], ["ü", "u"], ["ñ", "n"], ["Á", "a"], ["É", "e"], ["Í", "i"], ["Ó", "o"], ["Ú", "u"], ["Ü", "u"], ["Ñ", "n"]];
const foldedText = `lower(${accentPairs.reduce((expression, [from, to]) => `replace(${expression}, '${from}', '${to}')`, searchableText)})`;
const escapeLike = (term: string) => term.replace(/[\\%_]/g, "\\$&");

export function publicationSearchQuery(query: string, cursor?: string, pageSize = PUBLICATION_SEARCH_PAGE_SIZE, kind?: PublicationSearchKind) {
  if (query.length > 120) throw new Error("Búsqueda demasiado larga.");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 80) throw new Error("Límite de búsqueda inválido.");
  const terms = query.trim().split(/\s+/).filter(Boolean);
  if ((!terms.length && !kind) || terms.length > 8 || kind && !PUBLICATION_SEARCH_KINDS.includes(kind)) throw new Error("Búsqueda inválida.");
  const params: (string | number)[] = terms.map((term) => {
    const folded = term.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return `%${escapeLike(folded)}%`;
  });
  let cursorCondition = "";
  if (cursor) {
    let value: unknown;
    try { value = JSON.parse(cursor); } catch { throw new Error("Cursor inválido."); }
    if (!Array.isArray(value) || value.length !== 2 || value.some(part => typeof part !== "string" || part.length > 200 || !part.length)) throw new Error("Cursor inválido.");
    cursorCondition = " AND (updated_at < ? OR (updated_at = ? AND id < ?))";
    params.push(value[0], value[0], value[1]);
  }
  if (kind && kind !== "all") params.unshift(kind);
  const sql = `SELECT * FROM publications WHERE kind IN ('vacante','capacitacion','junta','informacion')
    ${kind && kind !== "all" ? "AND kind=?" : ""}
    AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.official.canonicalId') IS NULL ELSE 1 END)
    ${terms.length ? `AND ${terms.map(() => `${foldedText} LIKE ? ESCAPE '\\'`).join(" AND ")}` : ""}${cursorCondition}
    ORDER BY updated_at DESC, id DESC LIMIT ${pageSize + 1}`;
  return { sql, params };
}
