import { env } from "cloudflare:workers";
import type { D1Database, D1PreparedStatement } from "@cloudflare/workers-types";
import type { Publication } from "./types.ts";
import { catalogHash } from "./fdci-static-catalog.ts";
import { createFdciVersionedReader, FDCI_RAW_ACTIVE_URL } from "./fdci-static-publication.ts";
import { fdciPersonalMetadata } from "./fdci-personal-contract.ts";
import { isKnownFdciSynthetic } from "./fdci-canary-synthetic.ts";
import { isSameOriginMutation } from "./auth-identity.ts";
export class FdciPersonalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export function fdciPersonalEnabled(request: Request) {
  return (env as unknown as { FDCI_PERSONAL_ACTIONS_ENABLED?: string }).FDCI_PERSONAL_ACTIONS_ENABLED === "true" &&
    ["localhost", "127.0.0.1", "canary.docentetuc.com.ar"].includes(new URL(request.url).hostname);
}
// Bound cold validation; a larger snapshot fails closed instead of processing it in the action path.
const read = createFdciVersionedReader(FDCI_RAW_ACTIVE_URL, fetch, () => Date.now(), 131_072);
type Snapshot = Awaited<ReturnType<typeof read>>;
let cached: Snapshot | null = null, expires = 0, pending: Promise<Snapshot> | null = null;
async function snapshot() {
  if (cached && Date.now() < expires) return cached;
  pending ??= read().then(result => { cached = result; expires = Date.now() + (result.status === "ready" ? 60_000 : 0); return result; }).finally(() => { pending = null; });
  return pending;
}
export type PreparedFdciAction = { publication: Publication; insert: D1PreparedStatement | null; hash: string | null };
export async function prepareFdciPersonalAction(db: D1Database, request: Request, body: Record<string, unknown>, id: string): Promise<PreparedFdciAction | null> {
  if (!id.startsWith("fdci:")) return null;
  if (isKnownFdciSynthetic(id)) throw new FdciPersonalError(400, "Identificador FDCI sintético.");
  const existing = await db.prepare("SELECT * FROM publications WHERE id=?").bind(id).first<Publication>();
  let old; try { old = JSON.parse(existing?.metadata || "{}") ?? {}; } catch { old = {}; }
  if (existing && old.catalogOnly !== true) return { publication: existing, insert: null, hash: null };
  if (!fdciPersonalEnabled(request)) throw new FdciPersonalError(503, "Las acciones externas FDCI están deshabilitadas.");
  if (!isSameOriginMutation(request)) throw new FdciPersonalError(403, "Origen de solicitud no autorizado.");
  if (isKnownFdciSynthetic(id) || !/^fdci:commission:[1-9]\d{0,11}$/.test(id)) throw new FdciPersonalError(400, "Identificador FDCI no autorizado.");
  const ref = body.fdciCatalog as { generation?: number; catalogSha256?: string } | undefined;
  if (!Number.isSafeInteger(ref?.generation) || !/^[a-f0-9]{64}$/.test(ref?.catalogSha256 ?? "")) throw new FdciPersonalError(409, "Volvé a verificar el catálogo versionado.");
  const state = await snapshot();
  if (state.status !== "ready" || !state.catalog || !state.generation) throw new FdciPersonalError(503, "No hay un catálogo reciente verificable.");
  if (state.generation !== ref!.generation || state.catalogSha256 !== ref!.catalogSha256) throw new FdciPersonalError(409, "El catálogo cambió. Revisá la versión actual.");
  const item = state.items.find(i => i.id === id);
  if (!item || ["CLOSED", "EXPIRED", "UNKNOWN"].includes(item.normalizedStatus!)) throw new FdciPersonalError(409, "La capacitación ya no está disponible para nuevas acciones.");
  const metadata = fdciPersonalMetadata(state.catalog, item, state.generation);
  const hash = await catalogHash({ item, evidence: state.catalog.reminderEvidence?.[id] ?? null });
  if (existing) {
    if (old.catalogOrigin !== "fdci-versioned" || existing.content_hash !== hash) throw new FdciPersonalError(409, "La capacitación guardada cambió; se conservan tus datos sin sobrescribirla.");
    return { publication: existing, insert: null, hash };
  }
  const publication = { id, source: "Capacitación Docente", external_id: item.externalId!, kind: "capacitacion", category: item.category!,
    title: item.title!, summary: item.summary!, level: item.level!, area: item.area!, location: item.location!, character: item.character!,
    starts_at: item.startsAt, ends_at: item.endsAt, status: item.status!, official_url: item.officialUrl!, normalized_status: item.normalizedStatus!,
    metadata: JSON.stringify(metadata), content_hash: hash } as Publication;
  const columns = ["id", "source", "external_id", "kind", "category", "title", "summary", "level", "area", "location", "character", "starts_at", "ends_at", "status", "official_url", "normalized_status", "metadata", "content_hash"] as const;
  const insert = db.prepare(`INSERT INTO publications(${columns.join(",")},registration_open_at,registration_close_at) VALUES(${columns.map(()=>"?").join(",")},?,?) ON CONFLICT(id) DO NOTHING`)
    .bind(...columns.map(k => publication[k] ?? null), item.registrationOpenAt, item.registrationCloseAt);
  return { publication, insert, hash };
}
