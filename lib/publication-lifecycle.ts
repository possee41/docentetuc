export const PUBLICATION_LIFECYCLE = ["ACTIVE", "UPCOMING", "CLOSED", "EXPIRED", "REMOVED_FROM_SOURCE", "UNKNOWN"] as const;
export type PublicationLifecycle = typeof PUBLICATION_LIFECYCLE[number];
export const SOURCE_SYNC_STATUSES = ["OK", "PARTIAL", "EMPTY_SUSPECT", "TIMEOUT", "HTTP_ERROR", "PARSE_ERROR", "FORMAT_CHANGED", "UNKNOWN"] as const;
export type SourceSyncStatus = typeof SOURCE_SYNC_STATUSES[number];

export type SourceHealthSnapshot = {
  sync_status?: string | null;
  last_successful_sync_at?: string | null;
  synced_at?: string | null;
};

const timestampValue = (value: string) => Date.parse(/(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value.replace(" ", "T")}Z`);

export function classifySourceError(error: unknown): SourceSyncStatus {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error || "");
  if (/timeout|timed out|aborterror|aborted/i.test(message)) return "TIMEOUT";
  if (/\bHTTP[_ :]*(?:4\d\d|5\d\d)\b|\b(?:4\d\d|5\d\d)\s+https?:/i.test(message)) return "HTTP_ERROR";
  if (/FORMAT_CHANGED/i.test(message)) return "FORMAT_CHANGED";
  return "PARSE_ERROR";
}

export function assessSourceSync(input: { previousCount: number; recordsFound: number; complete?: boolean; formatValid?: boolean; error?: unknown }): SourceSyncStatus {
  if (input.error) return classifySourceError(input.error);
  if (input.formatValid === false) return "FORMAT_CHANGED";
  if (input.complete === false) return "PARTIAL";
  if (input.recordsFound === 0 && input.previousCount > 0) return "EMPTY_SUSPECT";
  return "OK";
}

export function missingAfterValidatedSync(previousIds: string[], currentIds: string[], status: SourceSyncStatus) {
  if (status !== "OK" || currentIds.length === 0) return [];
  const present = new Set(currentIds);
  return previousIds.filter((id) => !present.has(id));
}

export function publicationLifecycle(input: {
  sourceStatus?: string | null;
  normalizedStatus?: string | null;
  sourceStatusIsExplicit?: boolean;
  registrationOpenAt?: string | null;
  registrationCloseAt?: string | null;
  expiresAt?: string | null;
  dateStatus?: string | null;
  now?: Date;
}): PublicationLifecycle {
  const normalized = String(input.normalizedStatus || "").toUpperCase();
  const source = String(input.sourceStatus || "").toLowerCase();
  if (normalized === "REMOVED_FROM_SOURCE" || source === "removed_from_source") return "REMOVED_FROM_SOURCE";

  const now = (input.now || new Date()).getTime();
  const dateStatus = String(input.dateStatus || "").toLowerCase();
  const certainDate = ["confirmed", "course_confirmed"].includes(dateStatus);
  // Parser-derived course states are not proof when the source marks its dates
  // tentative, as a general catalogue window, or unknown.
  if (["tentative", "general_window", "unknown"].includes(dateStatus)) return "UNKNOWN";
  const expiry = input.expiresAt ? Date.parse(input.expiresAt) : Number.NaN;
  if (Number.isFinite(expiry) && expiry < now) return "EXPIRED";

  const close = input.registrationCloseAt ? Date.parse(input.registrationCloseAt) : Number.NaN;
  if (Number.isFinite(close) && close < now) return "CLOSED";

  const open = input.registrationOpenAt ? Date.parse(input.registrationOpenAt) : Number.NaN;
  if (Number.isFinite(open) && open > now && certainDate) return "UPCOMING";
  if (input.sourceStatusIsExplicit && /cerrad|finaliz|vencid|expired|closed/i.test(source)) return "CLOSED";
  if (input.sourceStatusIsExplicit && /abiert|vigente|active|verificado/i.test(source)) return "ACTIVE";
  if (normalized === "ACTIVE" || normalized === "UPCOMING" || normalized === "CLOSED" || normalized === "EXPIRED") return normalized;
  return "UNKNOWN";
}

export function sourceFreshness(health: SourceHealthSnapshot | undefined, now = new Date(), maxAgeMs = 24 * 60 * 60_000) {
  if (!health) return { fresh: false, verifiedAt: null as string | null };
  const value = health.last_successful_sync_at || (!health.sync_status ? health.synced_at : null) || null;
  if (!value) return { fresh: false, verifiedAt: null as string | null };
  const timestamp = timestampValue(value);
  return { fresh: Number.isFinite(timestamp) && now.getTime() - timestamp <= maxAgeMs && timestamp <= now.getTime(), verifiedAt: value };
}

export function canRecommendCurrentPublication(input: {
  lifecycle: PublicationLifecycle;
  health?: SourceHealthSnapshot;
  now?: Date;
  maxAgeMs?: number;
}) {
  const active = input.lifecycle === "ACTIVE" || input.lifecycle === "UPCOMING";
  return active && sourceFreshness(input.health, input.now, input.maxAgeMs).fresh;
}

export function elapsedLabel(timestamp: string | null | undefined, now = new Date()) {
  if (!timestamp) return "sin verificación exitosa";
  const date = new Date(timestampValue(timestamp));
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (!Number.isFinite(date.getTime())) return "sin verificación exitosa";
  if (minutes < 1) return "verificado recién";
  if (minutes < 60) return `verificado hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `verificado hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "última comprobación: ayer" : `última comprobación hace ${days} días`;
}
