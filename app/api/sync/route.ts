import { getD1 } from "@/db";
import { authError, currentUser } from "@/lib/current-user";
import { matchesProfile } from "@/lib/matching";
import { mergeTrainingData } from "@/lib/training";

export const dynamic = "force-dynamic";

type Publication = {
  id: string; source: string; externalId: string; kind: string; category: string; title: string; summary: string;
  level: string; area: string; junta: string; location: string; shift: string; character: string;
  startsAt: string | null; endsAt: string | null; status: string; officialUrl: string; metadata?: string; contentHash: string; sourceUpdatedAt: string | null;
};

const juntas = [
  [1, "Inicial y Primaria"], [2, "Secundaria"], [3, "Técnica, Agrotécnica y No Formal"], [4, "Superior, Especial y Artística"],
] as const;

const documents = [
  ["com-primaria", "Comunicados de Educación Inicial y Primaria", "Comunicados", "Inicial y Primaria", "https://docs.google.com/document/d/1Oo-LmX9DyPBfhZNHPRYYiRf6MJiN837VoSXK2F-LIZE/edit?usp=sharing"],
  ["com-secundaria", "Comunicados de Educación Secundaria", "Comunicados", "Secundaria", "https://docs.google.com/document/d/1PTKViYaH7i8CHcng99I51lKbZIkjwLnc3ctrJC5898g/edit?usp=sharing"],
  ["com-tecnica", "Comunicados de Educación Técnica, Agrotécnica y No Formal", "Comunicados", "Técnica, Agrotécnica y No Formal", "https://docs.google.com/document/d/1k0dIv5PJ-CuWabcKhL6mEf-lqfZbGps6V7VdS-ao1F8/edit?usp=sharing"],
  ["com-superior", "Comunicados de Nivel Superior, Especial y Artística", "Comunicados", "Superior, Especial y Artística", "https://docs.google.com/document/d/1SVQr81QbdgRdfqUAPdBhXBlYxpQwKIdDbqxK35tDoOI/edit?usp=sharing"],
  ["pad-primaria", "Padrones de Educación Inicial y Primaria", "Padrones", "Inicial y Primaria", "https://drive.google.com/drive/folders/0B9nsld8DcxkyZ04zbmxOTFNBNkE?resourcekey=0-N_tuv1wH33HaPvQKhxquww"],
  ["pad-secundaria", "Padrones de Educación Secundaria", "Padrones", "Secundaria", "https://drive.google.com/drive/folders/0B9nsld8DcxkydjZkRTBGV1JzSVE?resourcekey=0-71bD600USZEczBSRONjj-w"],
  ["pad-tecnica", "Padrones de Educación Técnica, Agrotécnica y No Formal", "Padrones", "Técnica, Agrotécnica y No Formal", "https://drive.google.com/drive/folders/0B9nsld8DcxkySC1NUWdSMkdlY2s?resourcekey=0-yI1BMkZQzYW4hFwVMbdvHA"],
  ["pad-superior", "Padrones de Educación Superior, Especial y Artística", "Padrones", "Superior, Especial y Artística", "https://drive.google.com/drive/folders/0B9nsld8DcxkyNzloZnlCbHZhUVE?resourcekey=0-QSoeQ-4hqb9joCnl8FgDrg"],
  ["abiertos-primaria", "Llamados abiertos de Inicial y Primaria", "Convocatorias", "Inicial y Primaria", "https://drive.google.com/drive/folders/1z9S807nunn8JiDl7C8VtBwPlrqb_OESq"],
  ["abiertos-superior", "Padrones de llamados abiertos", "Convocatorias", "Superior, Especial y Artística", "https://drive.google.com/drive/folders/1Cm6ICwm8v2wrmLcjq-yd-U2Bb2MEO6Fx"],
  ["res-ascenso", "Decreto 2926/5 — Ascenso de Jerarquía", "Resoluciones", "Todas", "https://padrones.educaciontuc.gov.ar/2020/ascenso.pdf"],
  ["res-valoracion", "Decreto 292/5 — Valoración de títulos y antecedentes", "Resoluciones", "Todas", "https://padrones.educaciontuc.gov.ar/2020/DECRETO_292.pdf"],
] as const;

const hash = async (value: string) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)))).map((byte) => byte.toString(16).padStart(2, "0")).join("");
const simeDate = (value?: string) => {
  if (!value) return null;
  const match = value.match(/(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2})/);
  return match ? `${match[3]}-${match[2]}-${match[1]}T${match[4]}:${match[5]}:00-03:00` : null;
};
const isOpen = (endsAt: string | null) => !endsAt || new Date(endsAt).getTime() >= Date.now();

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json", "User-Agent": "DocenteTuc/1.0 (+agregador de fuentes publicas)" } });
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json() as Promise<T>;
}

async function simePublications() {
  const items: Publication[] = [];
  for (const [juntaId, junta] of juntas) {
    const periodData = await getJson<{ periodos: { text: string }[] }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerPeriodos/${juntaId}?caracter=-1&tab=1`);
    const [month = "", year = ""] = (periodData.periodos[0]?.text || "").split("/");
    const data = await getJson<{ vacantes: { id: number; codigo: string; caracter: string; fechaPublicacionInicio: string; fechaPublicacionFin: string; cargos: string; abierto: boolean }[] }>(`https://sime.educaciontuc.gov.ar/Vacantes/ObtenerVacantes/${juntaId}?caracter=-1&tab=1&mesBuscar=${month}&anioBuscar=${year}`);
    for (const vacancy of data.vacantes || []) {
      const startsAt = simeDate(vacancy.fechaPublicacionInicio), endsAt = simeDate(vacancy.fechaPublicacionFin);
      const first = vacancy.cargos.split(", ")[0].replace(/^\[[^\]]+\]\s*/, "");
      const title = first.split(/\s+\[[^\]]*(?:TURNO|#)/i)[0].slice(0, 220);
      const shift = vacancy.cargos.match(/TURNO\s+([^\]]+)/i)?.[1]?.trim() || "";
      items.push({ id: `sime:${vacancy.id}`, source: "SIME", externalId: String(vacancy.id), kind: "vacante", category: "Vacante", title, summary: vacancy.cargos, level: junta, area: title, junta, location: "", shift, character: vacancy.caracter, startsAt, endsAt, status: isOpen(endsAt) ? "vigente" : "cerrada", officialUrl: `https://sime.educaciontuc.gov.ar/Vacantes/Detalle/${vacancy.id}?seleccionado=${juntaId - 1}&tab=1&accion=-1`, contentHash: await hash(JSON.stringify(vacancy)), sourceUpdatedAt: startsAt });
    }
  }
  return items;
}

async function trainingPublications() {
  const base = "https://apicapacitaciones.educaciontuc.edu.ar/api";
  const [courses, active] = await Promise.all([
    getJson<Record<string, unknown>[]>(`${base}/gestionCapas/getRestoCapas`),
    getJson<Record<string, unknown>[]>(`${base}/gestionCapas/getCapaActivas`),
  ]);
  return Promise.all(mergeTrainingData(courses, active).map(async (item): Promise<Publication> => ({
    id: item.id, source: "Capacitación Docente", externalId: item.externalId, kind: "capacitacion", category: item.metadata.entity === "commission" ? `Comisión #${item.metadata.commissionId}` : "Capacitación",
    title: item.title, summary: item.summary, level: item.level, area: item.area, junta: "", location: item.location, shift: "", character: item.modality,
    startsAt: item.startsAt, endsAt: item.endsAt, status: item.status, officialUrl: item.officialUrl, metadata: JSON.stringify(item.metadata),
    contentHash: await hash(JSON.stringify(item.raw)), sourceUpdatedAt: item.sourceUpdatedAt,
  })));
}

async function boardPublications() {
  return Promise.all(documents.map(async ([externalId, title, category, junta, officialUrl]): Promise<Publication> => {
    let fingerprint: string = officialUrl;
    if (officialUrl.includes("docs.google.com/document/")) {
      const docId = officialUrl.split("/d/")[1].split("/")[0];
      const response = await fetch(`https://docs.google.com/document/d/${docId}/export?format=html`);
      if (response.ok) fingerprint = await response.text();
    }
    return { id: `padrones:${externalId}`, source: "Padrones y Comunicados", externalId, kind: "junta", category, title, summary: `Documento público oficial de la Junta ${junta}.`, level: "", area: "", junta, location: "", shift: "", character: "", startsAt: null, endsAt: null, status: "vigente", officialUrl, metadata: "{}", contentHash: await hash(fingerprint), sourceUpdatedAt: null };
  }));
}

async function runSync() {
  const db = getD1();
  const previous = await db.prepare("SELECT id, content_hash FROM publications").all<{ id: string; content_hash: string }>();
  const old = new Map(previous.results.map((row) => [row.id, row.content_hash]));
  const results = await Promise.allSettled([simePublications(), trainingPublications(), boardPublications()]);
  const publications = results.flatMap((result) => result.status === "fulfilled" ? result.value : []);
  if (!publications.length) throw new Error("Las fuentes no respondieron.");
  const changed = publications.filter((item) => old.has(item.id) && old.get(item.id) !== item.contentHash);
  const fresh = publications.filter((item) => !old.has(item.id));
  for (let offset = 0; offset < publications.length; offset += 40) {
    await db.batch(publications.slice(offset, offset + 40).map((item) => db.prepare(`INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, junta, location, shift, character, starts_at, ends_at, status, official_url, metadata, content_hash, source_updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET source=excluded.source, category=excluded.category, title=excluded.title, summary=excluded.summary, level=excluded.level, area=excluded.area, junta=excluded.junta, location=excluded.location, shift=excluded.shift, character=excluded.character, starts_at=excluded.starts_at, ends_at=excluded.ends_at, status=excluded.status, official_url=excluded.official_url, metadata=excluded.metadata, content_hash=excluded.content_hash, source_updated_at=excluded.source_updated_at, updated_at=CURRENT_TIMESTAMP`).bind(item.id, item.source, item.externalId, item.kind, item.category, item.title, item.summary, item.level, item.area, item.junta, item.location, item.shift, item.character, item.startsAt, item.endsAt, item.status, item.officialUrl, item.metadata || "{}", item.contentHash, item.sourceUpdatedAt)));
  }
  if (results[1].status === "fulfilled") {
    await db.prepare("INSERT OR IGNORE INTO saved_publications (user_id, publication_id, in_agenda, followed, saved_at) SELECT s.user_id, 'fdci:course:' || p.external_id, s.in_agenda, s.followed, s.saved_at FROM saved_publications s JOIN publications p ON p.id=s.publication_id JOIN publications replacement ON replacement.id='fdci:course:' || p.external_id WHERE p.id LIKE 'fdci:%' AND p.id NOT LIKE 'fdci:course:%' AND p.id NOT LIKE 'fdci:commission:%'").run();
    await db.prepare("DELETE FROM publications WHERE id LIKE 'fdci:%' AND id NOT LIKE 'fdci:course:%' AND id NOT LIKE 'fdci:commission:%'").run();
  }
  const sourceCounts = new Map<string, number>();
  publications.forEach((item) => sourceCounts.set(item.source, (sourceCounts.get(item.source) || 0) + 1));
  await db.batch([...sourceCounts].map(([source, count]) => db.prepare("INSERT INTO sync_state (source, synced_at, item_count, error) VALUES (?, CURRENT_TIMESTAMP, ?, NULL) ON CONFLICT(source) DO UPDATE SET synced_at=CURRENT_TIMESTAMP, item_count=excluded.item_count, error=NULL").bind(source, count)));

  const profiles = await db.prepare("SELECT * FROM profiles").all<Record<string, unknown>>();
  const interesting = [...fresh.slice(0, 60), ...changed];
  for (const profile of profiles.results) {
    const match = (item: Publication) => {
      const fullProfile = { level: String(profile.level || ""), area: String(profile.area || ""), subjects: String(profile.subjects || ""), junta: String(profile.junta || ""), department: String(profile.department || ""), locality: String(profile.locality || ""), shifts: String(profile.shifts || ""), wantsInterim: Boolean(profile.wants_interim), wantsSubstitute: Boolean(profile.wants_substitute), trainingInterests: String(profile.training_interests || "") };
      if (item.kind !== "capacitacion") return matchesProfile(item, fullProfile);
      if (!Boolean(profile.notify_new_trainings)) return false;
      const scope = String(profile.training_notify_scope || "relevant");
      if (scope === "all") return true;
      if (scope === "level") return matchesProfile(item, { level: fullProfile.level });
      if (scope === "area") return matchesProfile(item, { area: fullProfile.area, subjects: fullProfile.subjects });
      if (scope === "interests") return matchesProfile(item, { trainingInterests: fullProfile.trainingInterests });
      return matchesProfile(item, fullProfile);
    };
    const statements = interesting.filter(match).map((item) => {
      const type = old.has(item.id) ? (item.kind === "junta" ? "PADRON_ACTUALIZADO" : "FECHA_IMPORTANTE") : item.kind === "vacante" ? "VACANTE_NUEVA" : item.kind === "capacitacion" ? "CAPACITACION_NUEVA" : item.category === "Comunicados" ? "COMUNICADO_NUEVO" : "PADRON_NUEVO";
      return db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type) VALUES (?, ?, ?)").bind(String(profile.user_id), item.id, type);
    });
    for (let offset = 0; offset < statements.length; offset += 40) await db.batch(statements.slice(offset, offset + 40));
  }
  return { count: publications.length, fresh: fresh.length, changed: changed.length, failures: results.filter((result) => result.status === "rejected").length };
}

export async function POST(request: Request) {
  try {
    await currentUser(request);
    const db = getD1();
    const latest = await db.prepare("SELECT MAX(synced_at) AS synced_at FROM sync_state").first<{ synced_at: string | null }>();
    if (latest?.synced_at && Date.now() - new Date(`${latest.synced_at}Z`).getTime() < 5 * 60_000) return Response.json({ ok: true, skipped: true });
    return Response.json({ ok: true, ...(await runSync()) });
  } catch (error) {
    console.error("sync_failed", error);
    return Response.json({ error: authError(error) ? "Iniciá sesión para actualizar." : "No se pudieron actualizar las fuentes. Probá nuevamente en unos minutos." }, { status: authError(error) ? 401 : 502 });
  }
}
