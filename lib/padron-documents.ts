import type { Publication } from "./types.ts";
import { normalizeOfficialText, officialMetadata } from "./official-publication.ts";

export type PadronType = "Provisorio" | "Definitivo" | "Complementario" | "Especial" | "Otro";

export const PADRON_PAGE_QUERY = `SELECT * FROM publications
  WHERE source='Padrones y Comunicados' AND kind='junta' AND id>?
    AND (category='Padrones' OR title LIKE '%padron%' OR title LIKE '%padrón%'
      OR CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.entity')='padron' ELSE 0 END)
  ORDER BY id LIMIT 201`;

// Only an explicit padrón/ciclo/vigencia label is evidence of its year.
export function padronTitleFacts(title: string) {
  const text = normalizeOfficialText(title);
  const years = [
    ...[...text.matchAll(/\bpadron(?:es)?\b([^.;,]{0,55}?)\b(20\d{2})\b/g)]
      .filter(match => !/\b(convocatoria|concurso|llamado|resolucion|publicad[oa]|actualizad[oa]|modificad[oa]|drive)\b/.test(match[1]))
      .map(match => Number(match[2])),
    ...[...text.matchAll(/\b(?:ciclo lectivo|vigencia)\s*(?:a[nñ]o\s*)?(20\d{2})\b/g)].map(match => Number(match[1])),
    ...[...text.matchAll(/\b(20\d{2})\s+padron(?:es)?\b/g)].map(match => Number(match[1])),
  ];
  const uniqueYears = [...new Set(years)];
  const typeWords = { Provisorio: /\bprovisori[oa]s?\b/, Definitivo: /\bdefinitiv[oa]s?\b/,
    Complementario: /\bcomplementari[oa]s?\b/, Especial: /\bespecial(?:es)?\b/ };
  const types = (Object.keys(typeWords) as Exclude<PadronType, "Otro">[]).filter(type => typeWords[type].test(text));
  const subject = title.match(/\b(?:concurso|cargo|materia)\s*[:–-]\s*([^;,]{3,100})/i)?.[0]?.trim() || null;
  const version = text.match(/\b(?:version|revision|v)\s*(\d+)\b/)?.[1] || null;
  return { year: uniqueYears.length === 1 ? uniqueYears[0] : null, type: types.length === 1 ? types[0] : "Otro" as PadronType, subject, version };
}

export function padronDocuments(items: Publication[]) {
  return items.filter(item => item.kind === "junta" && !officialMetadata(item)?.canonicalId &&
    (officialMetadata(item)?.entity === "padron" || item.category === "Padrones" || /\bpadron(?:es)?\b/i.test(normalizeOfficialText(item.title))));
}

export function padronYear(item: Publication) {
  const stored = officialMetadata(item)?.facts.padronYear?.value;
  return stored && /^20\d{2}$/.test(stored) ? Number(stored) : padronTitleFacts(item.title).year;
}

export function padronSelection(items: Publication[], now = new Date()) {
  const currentYear = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Argentina/Tucuman", year: "numeric" }).format(now));
  const years = [...new Set(items.map(padronYear).filter((year): year is number => year !== null && year <= currentYear))].sort((a, b) => b - a);
  const year = years[0] ?? currentYear;
  return { year, currentYear, current: items.filter(item => padronYear(item) === year),
    history: items.filter(item => padronYear(item) !== null && padronYear(item) !== year),
    undetermined: items.filter(item => padronYear(item) === null) };
}

export function groupPadrones(items: Publication[]) {
  const groups = new Map<string, Publication[]>();
  for (const item of items) {
    const key = [normalizeOfficialText(item.junta), padronYear(item) || "?",
      padronTitleFacts(item.title).type, normalizeOfficialText(item.title)
        .replace(/\.(?:pdf|docx?|xlsx?)\b/g, "")
        .replace(/\b(?:carpeta|archivo|documento|version|revision|v)\s*(?:\d+)?\b/g, "")
        .replace(/\s+/g, " ").trim()].join("|");
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const ranked = [...groups.values()].map(group => group.sort((a, b) =>
    Number(padronTitleFacts(b.title).version || 0) - Number(padronTitleFacts(a.title).version || 0) ||
    Number(officialMetadata(b)?.entity === "padron") - Number(officialMetadata(a)?.entity === "padron")));
  const priority: Record<PadronType, number> = { Definitivo: 0, Complementario: 1, Especial: 2, Provisorio: 3, Otro: 4 };
  return ranked.sort((a, b) => priority[padronTitleFacts(a[0].title).type] - priority[padronTitleFacts(b[0].title).type] ||
    Number(padronTitleFacts(b[0].title).version || 0) - Number(padronTitleFacts(a[0].title).version || 0) ||
    a[0].title.localeCompare(b[0].title, "es"));
}
