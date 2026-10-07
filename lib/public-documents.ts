export type DrivePublicEntry = { id: string; name: string; mimeType: string; updatedAt: string | null };

const entities: Record<string, string> = {
  amp: "&", apos: "'", gt: ">", lt: "<", nbsp: " ", quot: '"',
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ", uuml: "ü",
  deg: "°", ordm: "º", ordf: "ª", ndash: "–", mdash: "—", hellip: "…", bull: "•", middot: "·",
  laquo: "«", raquo: "»", ldquo: "“", rdquo: "”", lsquo: "‘", rsquo: "’",
};

const decodeNamedEntity = (entity: string) => {
  const decoded = entities[entity.toLowerCase()];
  return decoded && /^[A-Z]/.test(entity) && decoded.length === 1 ? decoded.toUpperCase() : decoded ?? `&${entity};`;
};

export function htmlToText(html: string, limit = 40_000) {
  return html
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<\/(?:div|h[1-6]|li|p|tr)>|<br\s*\/?>/gi, "\n")
    .replace(/<\/?(?:td|th)\b[^>]*>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity: string) => {
      if (entity[0] !== "#") return decodeNamedEntity(entity);
      const hex = entity[1]?.toLowerCase() === "x", code = Number.parseInt(entity.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : " ";
    })
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit);
}

export function plainDocumentText(value: string, limit = 40_000) {
  return value.replace(/\r\n?/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, limit);
}

export type DriveFolderPage = { entries: DrivePublicEntry[]; nextCursor: string | null; fullListing?: boolean };

export function parsePublicDrivePage(html: string, folderId: string): DriveFolderPage {
  const marker = "window['_DRIVE_ivd'] = '", start = html.indexOf(marker);
  if (start < 0) throw new Error("FORMAT_CHANGED Drive folder data marker missing");
  const end = html.indexOf("';", start + marker.length);
  if (end < 0) throw new Error("FORMAT_CHANGED Drive folder data incomplete");
  const decoded = html.slice(start + marker.length, end).replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  let tree: unknown;
  try { tree = JSON.parse(decoded); } catch { throw new Error("PARSE_ERROR Drive folder data invalid"); }
  const found = new Map<string, DrivePublicEntry>();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "string" && Array.isArray(value[1]) && value[1].includes(folderId) && typeof value[2] === "string" && typeof value[3] === "string") {
      const timestamps = value.filter((item): item is number => typeof item === "number" && item > 1_000_000_000_000);
      found.set(value[0], { id: value[0], name: value[2], mimeType: value[3], updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null });
    }
    value.forEach(visit);
  };
  const empty = Array.isArray(tree) && tree.length === 6 && tree[0] === null && tree[5] === 1 && Array.isArray(tree[4]) && tree[4].length > 0;
  if (!Array.isArray(tree) || (!Array.isArray(tree[0]) && !empty)) throw new Error("SCHEMA_ERROR Drive folder entries missing");
  visit(tree[0]);
  // The public bootstrap stops at 50. Its continuation is an internal Drive
  // token, not a URL. The official embedded view supplies the full public list
  // without borrowing Google's frontend API key or user cookies.
  const continuation = Array.isArray(tree[4]) && tree[4].some((row: unknown) => Array.isArray(row) && typeof row[3] === "string" && row[3]);
  return { entries: [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "es")), nextCursor: continuation || (tree[0]?.length ?? 0) >= 50 ? "embedded" : null };
}

export function parsePublicDriveFolder(html: string, folderId: string): DrivePublicEntry[] {
  return parsePublicDrivePage(html, folderId).entries;
}

export function parseEmbeddedDriveFolder(html: string): DriveFolderPage {
  if (!/class="flip-entries\b/.test(html) || !/<\/body>\s*<\/html>\s*$/i.test(html)) throw new Error("FORMAT_CHANGED Drive embedded listing missing or truncated");
  // Fail closed if this public view ever starts advertising additional pages.
  if (/nextPageToken|pageToken|flip-paging|load-more/i.test(html)) throw new Error("FORMAT_CHANGED Drive embedded pagination requires review");
  const entries = new Map<string, DrivePublicEntry>();
  const rows = html.split(/<div class="flip-entry"\s+id="entry-/).slice(1);
  for (const row of rows) {
    const id = row.match(/^([\w-]+)"/)?.[1];
    const href = row.match(/<a\s+href="([^"]+)"/)?.[1];
    const name = htmlToText(row.match(/<div class="flip-entry-title">([\s\S]*?)<\/div>/)?.[1] || "");
    const mime = row.match(/drive-thirdparty\.googleusercontent\.com\/\d+\/type\/([^"?]+)/)?.[1];
    if (!id || !name || !href) throw new Error("SCHEMA_ERROR Drive embedded entry incomplete");
    const url = new URL(href.replace(/&amp;/g, "&"));
    let mimeType = mime || "application/octet-stream";
    if (url.protocol !== "https:") throw new Error("SCHEMA_ERROR Drive embedded link is not HTTPS");
    if (url.hostname === "drive.google.com" && url.pathname === `/drive/folders/${id}`) mimeType = "application/vnd.google-apps.folder";
    else if (url.hostname === "docs.google.com" && /^\/(document|spreadsheets|presentation|drawings)\/d\//.test(url.pathname) && url.pathname.split("/")[3] === id) {
      const kind = url.pathname.split("/")[1].replace(/s$/, "");
      mimeType = `application/vnd.google-apps.${kind}`;
    } else if (url.hostname !== "drive.google.com" || !url.pathname.startsWith(`/file/d/${id}/`)) throw new Error("SCHEMA_ERROR Drive embedded link does not match entry");
    entries.set(id, { id, name, mimeType, updatedAt: null });
  }
  if ((html.match(/class="flip-entry"/g) || []).length !== rows.length) throw new Error("SCHEMA_ERROR Drive embedded entry format changed");
  return { entries: [...entries.values()], nextCursor: null, fullListing: true };
}

export async function fetchPublicDrivePage(folderId: string, cursor: string | null, rootUrl?: string): Promise<DriveFolderPage> {
  if (cursor !== null && cursor !== "embedded") throw new Error("SCHEMA_ERROR Unknown public Drive continuation");
  const initialUrl = rootUrl || `https://drive.google.com/drive/folders/${folderId}`;
  const url = cursor ? new URL("https://drive.google.com/embeddedfolderview") : new URL(initialUrl);
  if (cursor) {
    url.searchParams.set("id", folderId);
    const resourceKey = new URL(initialUrl).searchParams.get("resourcekey");
    if (resourceKey) url.searchParams.set("resourcekey", resourceKey);
  }
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`HTTP_${response.status} Drive folder`);
  const html = await response.text();
  return cursor ? parseEmbeddedDriveFolder(html) : parsePublicDrivePage(html, folderId);
}

export function driveEntryUrl(entry: Pick<DrivePublicEntry, "id" | "mimeType">) {
  if (entry.mimeType === "application/vnd.google-apps.folder") return `https://drive.google.com/drive/folders/${entry.id}`;
  if (entry.mimeType === "application/vnd.google-apps.document") return `https://docs.google.com/document/d/${entry.id}/edit`;
  return `https://drive.google.com/file/d/${entry.id}/view`;
}
