import { env } from "cloudflare:workers";
import { getAuthenticatedAccount } from "@/lib/auth-session";
import { catalogHash } from "./fdci-static-catalog.ts";
import { FDCI_PERSONAL_FIXTURE_ID } from "./fdci-personal-fixture-id.ts";
import type { Publication } from "./types.ts";
import type { D1Database } from "@cloudflare/workers-types";

const settings = () => env as unknown as Record<string, string | undefined>;
export function fdciPersonalEnabled(request: Request, userId?: string, accountId?: string, cleanup = false) {
  const e = settings();
  if (!cleanup && e.FDCI_PERSONAL_ACTIONS_ENABLED !== "true" || e.FDCI_CANARY_TEST_ENVIRONMENT !== "docentetuc-web-canary-1-2" ||
      !["localhost", "127.0.0.1", "canary.docentetuc.com.ar"].includes(new URL(request.url).hostname) || !accountId || userId !== accountId) return false;
  try {
    const allowed: unknown = JSON.parse(e.FDCI_CANARY_TEST_USER_IDS ?? "[]");
    // A single explicitly configured stable account ID, never email, URL or browser claims.
    return Array.isArray(allowed) && allowed.length === 1 && typeof allowed[0] === "string" && allowed[0] === accountId;
  } catch { return false; }
}
export class FdciPersonalError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function requireFdciPersonalAccount(request: Request, userId: string, cleanup = false) {
  const account = await getAuthenticatedAccount(request);
  if (!fdciPersonalEnabled(request, userId, account?.accountId, cleanup)) throw new FdciPersonalError(403, "Prueba FDCI no autorizada para esta cuenta o entorno.");
  return account!.accountId;
}
let cached: { key: string; publication: Publication } | null = null;
export async function fdciCanaryFixture(request: Request, userId: string, cleanup = false) {
  const accountId = await requireFdciPersonalAccount(request, userId, cleanup), e = settings();
  const opens = e.FDCI_CANARY_FIXTURE_OPENS_AT ?? "", expires = e.FDCI_CANARY_FIXTURE_EXPIRES_AT ?? "", run = e.FDCI_CANARY_FIXTURE_RUN_ID ?? "";
  if (!/^[a-f0-9-]{36}$/.test(run) || !Number.isFinite(Date.parse(opens)) || !Number.isFinite(Date.parse(expires)) ||
      !cleanup && (e.FDCI_CANARY_FIXTURE_ENABLED !== "true" || Date.parse(opens) < Date.now() + 86_400_000 ||
      Date.parse(expires) <= Date.now() || Date.parse(expires) > Date.now() + 1_800_000))
    throw new FdciPersonalError(403, "Fixture privado cerrado o sin configuración válida.");
  const key = JSON.stringify({ accountId, run, opens, expires });
  const cache = cached?.key === key ? "warm" : "cold";
  if (cache === "cold") {
    const hash = await catalogHash({ id: FDCI_PERSONAL_FIXTURE_ID, accountId, run, opens, expires });
    cached = { key, publication: {
      id: FDCI_PERSONAL_FIXTURE_ID, source: "FDCI", external_id: "canary-personal:1", kind: "capacitacion", category: "Capacitaciones",
      title: "FICTICIA — ensayo privado FDCI Canary", summary: "Una capacitación sintética. No es oferta oficial, no admite inscripción y no envía avisos.",
      level: "Primario", area: "Matemática", location: "Solo ensayo privado", character: "Simulada", junta: "", shift: "", official_url: "",
      status: "próximamente", normalized_status: "UPCOMING", starts_at: null, ends_at: null, content_hash: hash,
      first_seen_at: "", updated_at: "", registration_open_at: opens,
      metadata: JSON.stringify({ catalogOnly: true, preview: true, fdciCanaryFixture: true, fixtureRunId: run, fixtureOwnerId: accountId,
        fixtureExpiresAt: expires, catalogOrigin: "fdci-canary-fixture", catalogGeneration: 1, catalogSha256: hash,
        catalogCompletedAt: new Date(Date.parse(expires) - 1_800_000).toISOString(), catalogStale: false,
        entity: "commission", trainingId: FDCI_PERSONAL_FIXTURE_ID, registrationOpensAt: opens,
        registrationHasTime: true, dateStatus: "confirmed", availablePreCapacity: 1 }) } };
  }
  // A synthetic cache is separate from the official reader's cache and must not be presented as that measurement.
  return { publication: structuredClone(cached!.publication), cache };
}

export async function cleanupFdciCanaryFixture(db: D1Database, userId: string, publication: Publication) {
  const row = await db.prepare("SELECT content_hash,metadata FROM publications WHERE id=?").bind(FDCI_PERSONAL_FIXTURE_ID).first<{content_hash:string;metadata:string}>();
  if (!row) return;
  let m; try { m = JSON.parse(row.metadata); } catch { m = null; }
  if (row.content_hash !== publication.content_hash || row.metadata !== publication.metadata || m?.fdciCanaryFixture !== true || m.fixtureOwnerId !== userId)
    throw new FdciPersonalError(409, "No se elimina un registro ajeno al ensayo configurado.");
  const relations = ["saved_publications", "training_reminders", "notifications", "designation_tracking"];
  for (const table of relations) {
    if (await db.prepare(`SELECT 1 FROM ${table} WHERE publication_id=? AND user_id<>? LIMIT 1`).bind(FDCI_PERSONAL_FIXTURE_ID,userId).first())
      throw new FdciPersonalError(409, "Existen referencias de otra cuenta; limpieza suspendida.");
  }
  const hashGuard = "EXISTS(SELECT 1 FROM publications WHERE id=? AND content_hash=? AND metadata=?)";
  await db.batch([
    ...relations.map(table => db.prepare(`DELETE FROM ${table} WHERE publication_id=? AND user_id=? AND ${hashGuard}`).bind(FDCI_PERSONAL_FIXTURE_ID,userId,FDCI_PERSONAL_FIXTURE_ID,publication.content_hash!,publication.metadata)),
    db.prepare("DELETE FROM publications WHERE id=? AND content_hash=? AND metadata=?").bind(FDCI_PERSONAL_FIXTURE_ID,publication.content_hash!,publication.metadata),
  ]);
  if (await db.prepare("SELECT 1 FROM publications WHERE id=?").bind(FDCI_PERSONAL_FIXTURE_ID).first())
    throw new FdciPersonalError(409, "El fixture cambió durante la limpieza; no se eliminó.");
}
