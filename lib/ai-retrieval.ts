import type { D1Database } from "@cloudflare/workers-types";
import { detectIntent } from "./ai.ts";
import { publicationSearchQuery } from "./publication-search.ts";
import type { Publication } from "./types.ts";

const publicKinds = "kind IN ('vacante','capacitacion','junta','informacion')";
const canonical = "(CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.official.canonicalId') IS NULL ELSE 1 END)";
const noise = new Set("que cuales cual hay tiene tienen sobre para entre esta este estos estas hoy manana proximas proximos proxima proximo recientes reciente vigente vigentes abierto abiertos abierta abiertas cerrada cerradas cerrados fecha fechas docente docentes curso cursos capacitacion capacitaciones inscripcion inscripciones designacion designaciones llamado llamados comunicado comunicados resolucion resoluciones padron padrones informacion datos donde cuando como desde hasta nivel junta acto actos quiero necesito".split(" "));

export function aiSearchTerms(question: string) {
  return [...new Set(question.toLocaleLowerCase("es").normalize("NFD").replace(/[\u0300-\u036f]/g, "").split(/[^a-z0-9]+/)
    .filter((term) => term.length >= 3 && !noise.has(term)).map((term) => term.slice(0, 39)))].slice(0, 3);
}

function intentWhere(intent: ReturnType<typeof detectIntent>) {
  if (["capacitaciones", "inscripcion"].includes(intent)) return "kind='capacitacion'";
  if (["vacantes", "designaciones"].includes(intent)) return "kind='vacante'";
  if (["llamados", "junta", "documentos"].includes(intent)) return "kind='junta'";
  if (["informacion", "licencias", "inasistencia", "titulos"].includes(intent)) return "kind='informacion'";
  return publicKinds;
}

// A bounded candidate set from D1, independent of /api/app's 1,500-row list.
// The existing intent-aware ranker reduces these rows to at most eight citations.
export async function retrieveAIRecords(database: D1Database, question: string, options: { focusedId?: string; agendaUserId?: string } = {}) {
  const intent = detectIntent(question);
  if (intent === "conversacion_general") return [];
  const terms = aiSearchTerms(question);
  const search = terms.length ? publicationSearchQuery(terms.join(" "), undefined, 80) : null;
  const [matching, recent, focused, agenda] = await Promise.all([
    search ? database.prepare(search.sql).bind(...search.params).all<Publication>() : Promise.resolve({ results: [] as Publication[] }),
    database.prepare(`SELECT * FROM publications WHERE ${intentWhere(intent)} AND ${canonical}
      ORDER BY CASE WHEN normalized_status IN ('ACTIVE','UPCOMING') THEN 0 ELSE 1 END,
      COALESCE(source_published_at,last_changed_at,updated_at) DESC LIMIT 80`).all<Publication>(),
    options.focusedId ? database.prepare(`SELECT * FROM publications WHERE id=? AND ${publicKinds}`).bind(options.focusedId).first<Publication>() : Promise.resolve(null),
    intent === "agenda" && options.agendaUserId ? database.prepare(`SELECT p.* FROM saved_publications s JOIN publications p ON p.id=s.publication_id
      WHERE s.user_id=? AND s.in_agenda=1 ORDER BY s.saved_at DESC LIMIT 100`).bind(options.agendaUserId).all<Publication>() : Promise.resolve({ results: [] as Publication[] }),
  ]);
  const unique = new Map<string, Publication>();
  for (const item of [focused, ...agenda.results, ...matching.results.slice(0, 80), ...recent.results]) if (item) unique.set(item.id, item);
  return [...unique.values()];
}
