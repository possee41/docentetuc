// Opt-in, replay-safe materialization of publication notices outside Workers.
// One page of profiles and at most five already-persisted publications per step.
import { circuitMatches, inferCircuit } from "../lib/circuits.ts";
import { designationRoleFromTitle, isEligibleForPersonalizedHome, matchesProfile, profileMatch } from "../lib/matching.ts";
import { notificationDedupeKey } from "../lib/notification-events.ts";
import { officialMetadata } from "../lib/official-publication.ts";
import { parseTrainingMetadata } from "../lib/training.ts";
import { registrationState } from "../lib/home-dashboard.ts";

const profileOf = (row) => ({
  level: String(row.level || ""), area: String(row.area || ""), subjects: String(row.subjects || ""),
  junta: String(row.junta || ""), roles: String(row.roles || ""), department: String(row.department || ""),
  locality: String(row.locality || ""), shifts: String(row.shifts || ""),
  characters: String(row.characters || "").split(/[,;|]/).filter(Boolean),
  circuits: String(row.circuits || "").split(/[,;|]/).filter(Boolean),
  personalMatchThreshold: Number(row.personal_match_threshold) || 85,
  wantsInterim: Boolean(row.wants_interim), wantsSubstitute: Boolean(row.wants_substitute),
  trainingInterests: String(row.training_interests || ""),
});

function matches(row, profile, now) {
  const wanted = profileOf(profile);
  if (wanted.circuits.length) {
    const circuit = row.circuit === "ALL" ? "todos los circuitos" :
      /^[iv]+$|^[1-5]$/i.test(row.circuit || "") ? `Circuito ${row.circuit}` : row.source_circuit_raw || "";
    if (circuitMatches(inferCircuit({ explicit: circuit, locality: row.location || row.source_circuit_raw || "" }), wanted.circuits) === false) return false;
  }
  const item = { ...row, sourceCircuitRaw: row.source_circuit_raw || "" };
  if (row.kind === "vacante") return isEligibleForPersonalizedHome({ ...item, role: designationRoleFromTitle(row.title) }, wanted);
  if (row.kind !== "capacitacion") return matchesProfile(item, wanted);
  if (!profile.notify_new_trainings) return false;
  const metadata = parseTrainingMetadata(row.metadata);
  if (metadata?.entity === "commission" && metadata.availablePreCapacity === 0) return false;
  const matchItem = metadata?.recipients ? { ...item, recipients: metadata.recipients } : item;
  const scope = String(profile.training_notify_scope || "relevant");
  if (scope === "all") return true;
  if (scope === "level") return matchesProfile(matchItem, { level: wanted.level });
  if (scope === "area") return matchesProfile(matchItem, { area: wanted.area, subjects: wanted.subjects });
  if (scope === "interests") return matchesProfile(matchItem, { trainingInterests: wanted.trainingInterests });
  const state = registrationState(metadata?.registrationOpensAt, metadata?.registrationClosesAt, now);
  return ["today", "tomorrow", "two-three", "four-seven", "eight-fourteen"].includes(state) &&
    isEligibleForPersonalizedHome(matchItem, wanted);
}

function noticeType(row, profile, change) {
  const official = officialMetadata(row), metadata = row.kind === "capacitacion" ? parseTrainingMetadata(row.metadata) : null;
  if (official?.entity === "event") return change === "updated" ? "FECHA_CAMBIADA" : "FECHA_IMPORTANTE";
  if (change === "updated") return row.kind === "junta" ? row.category === "Comunicados" ? "COMUNICADO_ACTUALIZADO" : "PADRON_ACTUALIZADO" :
    row.kind === "vacante" ? "DESIGNACION_CAMBIO" : "CAPACITACION_ACTUALIZADA";
  if (row.kind === "vacante") {
    const match = profileMatch({ ...row, role: designationRoleFromTitle(row.title) }, profileOf(profile));
    return `DESIGNACION_${match.status === "exact" ? "EXACTA" : "PARCIAL"}_${match.criteria.some((criterion) => criterion.key === "role" && criterion.matched) ? "CARGO" : "GENERAL"}`;
  }
  if (metadata?.entity === "commission") return "COMISION_NUEVA";
  if (row.kind === "capacitacion") return "CAPACITACION_NUEVA";
  return row.category === "Comunicados" ? "COMUNICADO_NUEVO" : "PADRON_NUEVO";
}

export async function materializeExternalNoticePage(db, { events, cursor = "", limit = 25, now = new Date() }) {
  if (!Array.isArray(events) || events.length < 1 || events.length > 5 ||
      !events.every((event) => typeof event.id === "string" && event.id.length <= 200 &&
        /^[a-f0-9]{64}$/.test(event.contentHash) && ["created", "updated"].includes(event.change)) ||
      new Set(events.map((event) => event.id)).size !== events.length ||
      typeof cursor !== "string" || cursor.length > 200 || !Number.isInteger(limit) || limit < 1 || limit > 25 ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("EXTERNAL_NOTICES_INVALID");

  const rows = [];
  for (const event of events) {
    const row = await db.prepare("SELECT * FROM publications WHERE id=? AND content_hash=?").bind(event.id, event.contentHash).first();
    if (!row) throw new Error("EXTERNAL_NOTICE_PUBLICATION_CHANGED");
    const official = officialMetadata(row);
    if (!["ACTIVE", "UPCOMING"].includes(row.normalized_status) || row.removed_at || row.kind === "informacion" ||
        row.id.startsWith("drive:") || (official && (official.canonicalId || official.entity === "reference" ||
          official.candidateIds?.length || official.topics.includes("CLASIFICACION_PENDIENTE")))) continue;
    rows.push({ row, event });
  }
  const page = await db.prepare("SELECT * FROM profiles WHERE user_id>? ORDER BY user_id LIMIT ?").bind(cursor, limit).all();
  const profiles = page.results || [];
  let considered = 0, inserted = 0;
  for (const profile of profiles) for (const { row, event } of rows) {
    if (!matches(row, profile, now)) continue;
    const type = noticeType(row, profile, event.change);
    const metadata = row.kind === "capacitacion" ? parseTrainingMetadata(row.metadata) : null;
    const date = metadata?.registrationOpensAt || metadata?.registrationClosesAt || row.ends_at || row.starts_at || row.source_updated_at || row.content_hash;
    const identity = event.change === "updated" ? `change:${row.content_hash}` : `date:${date}`;
    const key = notificationDedupeKey(row.id, type, identity);
    const result = await db.prepare("INSERT OR IGNORE INTO notifications (user_id, publication_id, type, dedupe_key, scheduled_at) VALUES (?, ?, ?, ?, ?)")
      .bind(profile.user_id, row.id, type, key, now.toISOString()).run();
    considered++;
    inserted += Number(result.meta?.rows_written || 0) > 0 ? 1 : 0;
  }
  return { profiles: profiles.length, considered, inserted, nextCursor: profiles.length === limit ? profiles.at(-1).user_id : null };
}
