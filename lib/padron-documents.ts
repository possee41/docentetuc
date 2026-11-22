import type { Publication } from "./types.ts";
import { normalizeOfficialText, officialMetadata } from "./official-publication.ts";
import { isPublicPublication, PUBLICATION_VISIBILITY_SQL } from "./publication-visibility.ts";
import { normalizeJunta } from "./juntas.ts";
import { JUNTA_EXTERNAL_SOURCES } from "./junta-external-sources.ts";

export type PadronType = "Provisorio" | "Definitivo" | "Complementario" | "Especial" | "Otro";

export const PADRON_PAGE_QUERY = `SELECT * FROM publications
  WHERE source='Padrones y Comunicados' AND kind='junta' AND id>?
    AND ${PUBLICATION_VISIBILITY_SQL}
    AND (category='Padrones' OR title LIKE '%padron%' OR title LIKE '%padrón%'
      OR CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.entity')='padron' ELSE 0 END)
  ORDER BY id LIMIT 201`;

// Only an explicit padrón/ciclo/vigencia label is evidence of its year.
export function padronTitleFacts(title: string) {
  const text = normalizeOfficialText(title).replace(/\b(padron(?:es)?)\s+def\.(?=\s|$)/g, "$1 definitivo");
  const years = [
    ...[...text.matchAll(/\bpadron(?:es)?\b([^.;,]{0,55}?)\b(20\d{2})\b(?:\s*(?:y|\/|a|–|-)\s*(20\d{2})\b)?/g)]
      .filter(match => !/\b(convocatoria|concurso|llamado|resolucion|publicad[oa]|actualizad[oa]|modificad[oa]|drive)\b/.test(match[1]))
      .flatMap(match => match[3] ? [Number(match[2]),Number(match[3])] : [Number(match[2])]),
    ...[...text.matchAll(/\b(?:ciclo lectivo|vigencia)\s*(?:a[nñ]o\s*)?(20\d{2})\b/g)].map(match => Number(match[1])),
    ...[...text.matchAll(/\b(20\d{2})\s+padron(?:es)?\b/g)].map(match => Number(match[1])),
  ];
  const uniqueYears = [...new Set(years)];
  const typeWords = { Provisorio: /\bprovisori[oa]s?\b/, Definitivo: /\bdefinitiv[oa]s?\b|\bpadron(?:es)?\s+def\.?(?=\s|$)/,
    Complementario: /\bcomplementari[oa]s?\b/, Especial: /\bpadron(?:es)?\s+especial(?:es)?\b/ };
  const types = (Object.keys(typeWords) as Exclude<PadronType, "Otro">[]).filter(type => typeWords[type].test(text));
  const subject = title.match(/\b(?:concurso|cargo|materia)\s*[:–-]\s*([^;,]{3,100})/i)?.[0]?.trim() || null;
  const version = text.match(/\b(?:version|revision|v)\s*(\d+)\b/)?.[1] || null;
  return { year: uniqueYears.length === 1 ? uniqueYears[0] : null, type: types.length === 1 ? types[0] : "Otro" as PadronType,
    yearAmbiguous: uniqueYears.length > 1, typeAmbiguous: types.length > 1, subject, version };
}

export function padronDocuments(items: Publication[]) {
  return padronCandidates(items).filter(item => padronRecordKind(item) === 'document');
}

function padronCandidates(items: Publication[]) {
  return items.filter(item => isPublicPublication(item) && item.kind === "junta" && !officialMetadata(item)?.canonicalId &&
    (officialMetadata(item)?.entity === "padron" || item.category === "Padrones" || /\bpadron(?:es)?\b/i.test(normalizeOfficialText(item.title))));
}

export function padronRecordKind(item: Publication): 'document'|'folder'|'notice'|'reference' {
  const entity=officialMetadata(item)?.entity;
  if(item.id.startsWith('notice:')||['notice','event','opportunity'].includes(entity||''))return 'notice';
  if(item.id.startsWith('padrones:com-'))return 'reference';
  try {
    const url=new URL(item.official_url);
    if(url.hostname==='drive.google.com'&&url.pathname.startsWith('/drive/folders/'))return 'folder';
    const file=url.hostname==='drive.google.com'&&url.pathname.startsWith('/file/d/')||
      url.hostname==='docs.google.com'&&/^\/(?:document|spreadsheets)\/d\//.test(url.pathname);
    if(file&&(!entity||entity==='padron'))return 'document';
  }catch{ /* A malformed or unverified reference is never a verified document. */ }
  return 'reference';
}

export function padronReferences(items: Publication[]) {
  return padronCandidates(items).filter(item=>padronRecordKind(item)!=='document');
}

export function padronYear(item: Publication) {
  const stored = officialMetadata(item)?.facts.padronYear?.value;
  return stored && /^20\d{2}$/.test(stored) ? Number(stored) : padronTitleFacts(item.title).year;
}

export function padronFacts(item: Publication) {
  const parsed = padronTitleFacts(item.title), facts = officialMetadata(item)?.facts;
  const type = facts?.padronType?.value;
  return { ...parsed, year: padronYear(item),
    scope: /\bconcurso\b|ascenso de jerarquia/.test(normalizeOfficialText(item.title+' '+(facts?.padronScope?.value||''))) ? 'Concurso' : null,
    type: ["Provisorio", "Definitivo", "Complementario", "Especial"].includes(type || "") ? type as PadronType : parsed.type };
}

type CoverageRow={root_id:string;status:string;last_attempt_at?:string|null;category_status?:string|null};
export function padronCoverage(rows:CoverageRow[], junta='todas') {
  return JUNTA_EXTERNAL_SOURCES.filter(source=>source[1]==='Padrones'&&(junta==='todas'||normalizeJunta(source[2])===junta)).map(source=>{
    const full=rows.find(row=>row.root_id===source[0]),probe=rows.find(row=>row.root_id===`probe:${source[0]}`);
    const times=[full?.last_attempt_at,probe?.last_attempt_at].filter((value):value is string=>!!value&&Number.isFinite(Date.parse(value))).sort();
    // Category status also accounts for unacknowledged changes between probe and traversal.
    return {junta:source[2],state:!full||!probe?'unknown':full.status==='OK'&&probe.status==='OK'&&full.category_status==='OK'?'complete':'partial',lastCheckedAt:times.at(-1)||null};
  });
}

export function padronSelection(items: Publication[], now = new Date()) {
  const currentYear = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Argentina/Tucuman", year: "numeric" }).format(now));
  const years = [...new Set(items.map(padronYear).filter((year): year is number => year !== null && year <= currentYear))].sort((a, b) => b - a);
  const year = years[0] ?? currentYear;
  const latestByJunta = new Map<string, number>();
  const juntaKey = (item: Publication) => normalizeJunta(item.junta) || normalizeOfficialText(item.junta);
  for (const item of items) {
    const value = padronYear(item), junta = juntaKey(item);
    if (value !== null && value <= currentYear) latestByJunta.set(junta, Math.max(value, latestByJunta.get(junta) || 0));
  }
  const current = (item: Publication) => padronYear(item) === latestByJunta.get(juntaKey(item));
  return { year, currentYear, current: items.filter(current),
    history: items.filter(item => padronYear(item) !== null && !current(item)),
    undetermined: items.filter(item => padronYear(item) === null) };
}

export function groupPadrones(items: Publication[]) {
  const groups = new Map<string, Publication[]>();
  for (const item of items) {
    const key = [normalizeOfficialText(item.junta), padronYear(item) || "?",
      padronFacts(item).type, officialMetadata(item)?.facts.padronScope?.value || "", normalizeOfficialText(item.title)
        .replace(/\.(?:pdf|docx?|xlsx?)\b/g, "")
        .replace(/\b(?:carpeta|archivo|documento|version|revision|v)\s*(?:\d+)?\b/g, "")
        .replace(/\s+/g, " ").trim()].join("|");
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const ranked = [...groups.values()].map(group => group.sort((a, b) =>
    Number(padronFacts(b).version || 0) - Number(padronFacts(a).version || 0) ||
    Number(officialMetadata(b)?.entity === "padron") - Number(officialMetadata(a)?.entity === "padron")));
  const priority: Record<PadronType, number> = { Definitivo: 0, Complementario: 1, Especial: 2, Provisorio: 3, Otro: 4 };
  return ranked.sort((a, b) => priority[padronFacts(a[0]).type] - priority[padronFacts(b[0]).type] ||
    Number(padronTitleFacts(b[0].title).version || 0) - Number(padronTitleFacts(a[0].title).version || 0) ||
    a[0].title.localeCompare(b[0].title, "es"));
}
