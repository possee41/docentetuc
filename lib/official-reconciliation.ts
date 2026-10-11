import { designationFromOpportunity } from "./sime-publications.ts";
import { normalizeOfficialText, officialMetadata, opportunityTopics, withOfficial, type CollectedPublication, type OfficialFact, type OfficialMetadata } from "./official-publication.ts";

const same = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && normalizeOfficialText(a) === normalizeOfficialText(b);
export function relationStrength(a: OfficialMetadata, b: OfficialMetadata): "exact" | "strong" | "possible" | "none" {
  if (!same(a.junta, b.junta)) return "none";
  if (a.codes.length && b.codes.length) {
    if (!a.codes.some(x => b.codes.includes(x))) return "none";
    return a.codes.length === 1 && b.codes.length === 1 ? "exact" : "possible";
  }
  if ((a.positions?.length || 1) > 1 || (b.positions?.length || 1) > 1) return "possible";
  for (const k of ["school", "role", "subject", "hours", "shift", "character", "circuit"] as const) {
    if (a.scope[k] && b.scope[k] && !same(a.scope[k], b.scope[k])) return "none";
  }
  const datesAgree = a.facts.designation && b.facts.designation && same(a.facts.designation.value.slice(0, 10), b.facts.designation.value.slice(0, 10));
  const core = same(a.scope.school, b.scope.school) && same(a.scope.role, b.scope.role);
  // Missing hours/shift/circuit cannot manufacture a strong identity.
  const complete = (["hours", "shift", "character", "circuit"] as const).every(k => same(a.scope[k], b.scope[k])) &&
    (!a.scope.subject && !b.scope.subject || same(a.scope.subject, b.scope.subject));
  if (core && complete && datesAgree) return "strong";
  return core && datesAgree ? "possible" : "none";
}
function combineFact(old: OfficialFact | undefined, incoming: OfficialFact, correction: boolean): OfficialFact {
  if (!old) return incoming;
  const evidence = [...old.evidence, ...incoming.evidence].filter((x, i, all) => all.findIndex(y => y.id === x.id && y.excerpt === x.excerpt) === i);
  if (old.precision === "text" && incoming.precision === "text") {
    return { ...old, value: old.value === incoming.value ? old.value : `${old.value}\n\n${incoming.value}`, evidence };
  }
  if (correction) return { ...incoming, evidence };
  if (old.status === "provisional" && incoming.status === "reported" && old.value.slice(0, 10) === incoming.value.slice(0, 10)) return { ...incoming, evidence };
  if (old.value === incoming.value) return { ...incoming, evidence };
  if (old.value.slice(0, 10) === incoming.value.slice(0, 10) && (old.precision === "date" || incoming.precision === "date")) {
    return { ...(incoming.precision === "datetime" ? incoming : old), evidence };
  }
  return { ...old, status: "conflict", evidence, alternatives: [...(old.alternatives || []), { value: incoming.value, precision: incoming.precision, status: incoming.status, evidence: incoming.evidence }] };
}
function enrich(target: CollectedPublication, incoming: CollectedPublication) {
  const a = officialMetadata(target)!, b = officialMetadata(incoming)!;
  const sources = [...a.sources, ...b.sources].filter((x, i, all) => all.findIndex(y => y.id === x.id) === i);
  a.sources = sources;
  a.relatedIds = [...new Set([...a.relatedIds, incoming.id])];
  for (const [key, value] of Object.entries(b.facts)) {
    if (key === "previousDesignation") continue;
    a.facts[key] = combineFact(a.facts[key], value, !!b.correction && key === "designation");
    if (a.facts[key].status === "conflict") a.issues.push(`Conflicto entre fuentes en ${key}; requiere verificación.`);
  }
  if (a.facts.designation && /horario.{0,50}(a confirmar|tentativ)/i.test(normalizeOfficialText(incoming.summary))) {
    a.facts.designation = { ...a.facts.designation, status: "provisional", evidence: [...a.facts.designation.evidence, ...b.sources] };
  }
  if (a.facts.designation && b.facts.designationTime?.status === "reported") {
    const value = `${a.facts.designation.value.slice(0, 10)}T${b.facts.designationTime.value}:00-03:00`;
    a.facts.designation = combineFact(a.facts.designation, { value, precision: "datetime", status: "reported", evidence: b.facts.designationTime.evidence }, !!b.correction);
  }
  if (a.entity === "opportunity" && b.procedure !== "unknown") {
    a.procedure = a.procedure !== "unknown" && a.procedure !== b.procedure ? "both" : b.procedure;
    a.topics = opportunityTopics(a.procedure);
    a.issues = a.issues.filter(x => !x.startsWith("Procedimiento pendiente de verificar"));
    if (target.source === "SIME" && target.category === "Procedimiento pendiente de verificar")
      target.category = a.procedure === "direct" ? "Llamado abierto" : "Vacante";
  }
  a.issues = [...new Set(a.issues)];
  target.metadata = withOfficial(target.metadata, a);
}
function alias(item: CollectedPublication, canonical: CollectedPublication) {
  const m = officialMetadata(item)!;
  m.canonicalId = canonical.id; m.relatedIds = [...new Set([...m.relatedIds, canonical.id])];
  item.metadata = withOfficial(item.metadata, m);
}
export function reconcileOfficialPublications(input: CollectedPublication[]) {
  const items = input.map(x => ({ ...x }));
  const opportunities = items.filter(x => officialMetadata(x)?.entity === "opportunity" && x.source === "SIME");
  const boardItems = items.filter(x => x.source !== "SIME" && officialMetadata(x)).sort((a, b) => (a.sourcePublishedAt || "").localeCompare(b.sourcePublishedAt || ""));
  for (const notice of boardItems) {
    const n = officialMetadata(notice)!;
    if (n.entity !== "opportunity" && n.entity !== "event" && !n.correction && !n.codes.length) continue;
    let candidates = opportunities.map(x => ({ x, strength: relationStrength(officialMetadata(x)!, n) })).filter(x => x.strength !== "none");
    // Explicit reprogramming with an old date has a defined board/date scope,
    // not an arbitrary fuzzy association to every vacancy from that Junta.
    if (n.correction && n.facts.previousDesignation && !n.codes.length && !n.scope.school && !/artistica|especial/i.test(n.section || "")) {
      const before = n.facts.previousDesignation.value.slice(0, 10);
      candidates = opportunities.filter(x => {
        const a = officialMetadata(x)!;
        return same(a.junta, n.junta) && a.facts.designation?.value.slice(0, 10) === before;
      }).map(x => ({ x, strength: "exact" as const }));
      for (const { x } of candidates) enrich(x, notice);
      n.relatedIds = candidates.map(x => `acto:${x.x.id}`);
      notice.metadata = withOfficial(notice.metadata, n);
      continue;
    }
    const certain = candidates.filter(x => x.strength === "exact" || x.strength === "strong");
    if (certain.length !== 1) {
      if (candidates.length) {
        n.candidateIds = candidates.map(x => x.x.id);
        n.issues.push("Posible duplicado: vínculo pendiente; no se fusionó automáticamente.");
        notice.metadata = withOfficial(notice.metadata, n);
      }
      if (n.entity === "opportunity") opportunities.push(notice);
      continue;
    }
    const target = certain[0].x;
    enrich(target, notice);
    if (n.entity === "event" || n.entity === "opportunity") alias(notice, n.entity === "event" ? { ...target, id: `acto:${target.id}` } : target);
    else { n.relatedIds = [...new Set([...n.relatedIds, target.id])]; notice.metadata = withOfficial(notice.metadata, n); }
  }
  // Multiple portal placements can point to the same actual file. Keep all
  // legacy rows (and foreign keys), marking aliases instead of deleting them.
  const fileMap = new Map<string, CollectedPublication>();
  for (const item of items.filter(x => x.id.startsWith("drive:"))) {
    const key = item.officialUrl, first = fileMap.get(key);
    if (first && officialMetadata(item) && officialMetadata(first) && same(item.junta, first.junta)) {
      enrich(first, item); alias(item, first);
    } else fileMap.set(key, item);
  }
  for (const opportunity of opportunities) {
    const act = designationFromOpportunity(opportunity);
    if (act) items.push(act);
  }
  // Junta-only calls also have their own Acto, when the schedule is explicit.
  return [...new Map(items.map(x => [x.id, x])).values()];
}
export function resolveOfficialAlias<T extends { id: string; metadata?: string }>(item: T, all: T[]): T {
  const id = officialMetadata(item)?.canonicalId;
  return id ? all.find(x => x.id === id) || item : item;
}
export function officialSavedLookup<T extends { publication_id: string }>(saved: T[], all: { id: string; metadata?: string }[]) {
  const lookup = new Map(saved.map(x => [x.publication_id, x]));
  for (const record of saved) {
    const item = all.find(x => x.id === record.publication_id);
    if (!item) continue;
    const canonical = resolveOfficialAlias(item, all);
    if (!lookup.has(canonical.id)) lookup.set(canonical.id, record);
  }
  return lookup;
}
export function officialChange(previous?: string | null, current?: string | null) {
  const a = officialMetadata({ metadata: previous }), b = officialMetadata({ metadata: current });
  if (!a || !b) return false;
  // Poll timestamps are storage checkpoints, never notification identities.
  const meaningful = (x: OfficialMetadata) => ({ entity: x.entity, topics: x.topics, procedure: x.procedure,
    facts: Object.fromEntries(Object.entries(x.facts).map(([k, v]) => [k, { value: v.value, status: v.status, precision: v.precision }])), issues: x.issues.filter(s => /conflict/i.test(s)) });
  return JSON.stringify(meaningful(a)) !== JSON.stringify(meaningful(b));
}
