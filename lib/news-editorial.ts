export const NEWS_STATUSES = ["candidate", "approved", "published", "rejected", "archived"] as const;
export const NEWS_RELEVANCE = ["informativa", "importante", "urgente"] as const;
export const NEWS_SOURCE_TYPES = ["official", "public", "union", "media"] as const;

export function isNewsStatus(value: unknown): value is typeof NEWS_STATUSES[number] {
  return typeof value === "string" && NEWS_STATUSES.some((status) => status === value);
}

export function isNewsRelevance(value: unknown): value is typeof NEWS_RELEVANCE[number] {
  return typeof value === "string" && NEWS_RELEVANCE.some((relevance) => relevance === value);
}

export function isNewsSourceType(value: unknown): value is typeof NEWS_SOURCE_TYPES[number] {
  return typeof value === "string" && NEWS_SOURCE_TYPES.some((type) => type === value);
}

// Keep path and query semantics intact; only URL-standard canonicalization and fragments are removed.
export function normalizeNewsSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch { return null; }
}

export function isNewsWindow(validFrom: unknown, validUntil: unknown): boolean {
  const validDate = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  if (validFrom !== null && !validDate(validFrom)) return false;
  if (validUntil !== null && !validDate(validUntil)) return false;
  return validFrom === null || validUntil === null || (validFrom as string) < (validUntil as string);
}
