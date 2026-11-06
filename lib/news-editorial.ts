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

// Public audiences see three categories. A media article or a public body is educational
// coverage, never an official statement; only official sources and union sources keep
// their own category so readers can tell a communiqué from union information.
export const NEWS_CATEGORIES = ["oficial", "educativa", "gremial"] as const;
export type NewsCategory = typeof NEWS_CATEGORIES[number];

export function isNewsCategory(value: unknown): value is NewsCategory {
  return typeof value === "string" && NEWS_CATEGORIES.some((category) => category === value);
}

export function newsCategory(sourceType: unknown): NewsCategory {
  if (sourceType === "official") return "oficial";
  if (sourceType === "union") return "gremial";
  return "educativa";
}

// Keep path and query semantics intact; only URL-standard canonicalization and fragments are removed.
export function normalizeNewsSourceUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !url.hostname || url.username || url.password) return null;
    if (isPrivateOrLoopbackHost(url.hostname)) return null;
    url.hash = "";
    const normalized = url.toString();
    return normalized.length <= 2048 ? normalized : null;
  } catch { return null; }
}

// Prevent SSRF: feeds or admins must never target loopback, link-local or RFC1918 addresses.
export function isPrivateOrLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!host) return true;
  const normalized = host.replace(/\.$/, "");
  if (normalized === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0" || host === "::" || host === "::1") return true;
  // Block all IPv4-mapped IPv6 addresses (common SSRF bypass).
  if (host.includes("::ffff:")) return true;
  // Block bare numeric/octal/hex hostnames (decimal or encoded IPs).
  if (/^\d+$/.test(host) || /^0[0-7]/.test(host) || /^0x[0-9a-f]+$/i.test(host)) return true;
  // IPv6 ULA / link-local.
  if (/^f[cd][0-9a-f]{2}:/i.test(host) || /^fe[89ab][0-9a-f]:/i.test(host)) return true;
  // IPv4 dotted.
  const ipv4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4) {
    const parts = ipv4.slice(1).map(Number);
    if (parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    if (a === 0 || a === 127 || a === 10) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
  }
  return false;
}

export type NewsImage = { url: string; alt: string; credit: string; sourceUrl: string; rightsNote: string; rightsUrl: string };

// An image is either absent or fully attributable. Never publish a partially documented one.
export function normalizeNewsImage(input: Record<string, unknown>): NewsImage | null | undefined {
  const names = ["imageUrl", "imageAlt", "imageCredit", "imageSourceUrl", "imageRightsNote", "imageRightsUrl"] as const;
  if (names.some((name) => input[name] != null && typeof input[name] !== "string")) return undefined;
  const values = names.map((name) => String(input[name] ?? "").normalize("NFC").trim());
  if (values.every((value) => !value)) return null;
  const [rawUrl, alt, credit, rawSource, rightsNote, rawRights] = values;
  const url = normalizeNewsSourceUrl(rawUrl), sourceUrl = normalizeNewsSourceUrl(rawSource), rightsUrl = normalizeNewsSourceUrl(rawRights);
  if (!url || !sourceUrl || !rightsUrl || !alt || !credit || !rightsNote || alt.length > 240 || credit.length > 160 || rightsNote.length > 500) return undefined;
  return { url, alt, credit, sourceUrl, rightsNote, rightsUrl };
}

export function isNewsWindow(validFrom: unknown, validUntil: unknown): boolean {
  const validDate = (value: unknown): value is string =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
    && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString() === value;
  if (validFrom !== null && !validDate(validFrom)) return false;
  if (validUntil !== null && !validDate(validUntil)) return false;
  return validFrom === null || validUntil === null || (validFrom as string) < (validUntil as string);
}
