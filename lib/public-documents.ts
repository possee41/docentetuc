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

export function parsePublicDriveFolder(html: string, folderId: string): DrivePublicEntry[] {
  const marker = "window['_DRIVE_ivd'] = '", start = html.indexOf(marker);
  if (start < 0) return [];
  const end = html.indexOf("';", start + marker.length);
  if (end < 0) return [];
  const decoded = html.slice(start + marker.length, end).replace(/\\x([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  let tree: unknown;
  try { tree = JSON.parse(decoded); } catch { return []; }
  const found = new Map<string, DrivePublicEntry>();
  const visit = (value: unknown) => {
    if (!Array.isArray(value)) return;
    if (typeof value[0] === "string" && Array.isArray(value[1]) && value[1].includes(folderId) && typeof value[2] === "string" && typeof value[3] === "string") {
      const timestamps = value.filter((item): item is number => typeof item === "number" && item > 1_000_000_000_000);
      found.set(value[0], { id: value[0], name: value[2], mimeType: value[3], updatedAt: timestamps.length ? new Date(Math.max(...timestamps)).toISOString() : null });
    }
    value.forEach(visit);
  };
  visit(tree);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export function driveEntryUrl(entry: Pick<DrivePublicEntry, "id" | "mimeType">) {
  if (entry.mimeType === "application/vnd.google-apps.folder") return `https://drive.google.com/drive/folders/${entry.id}`;
  if (entry.mimeType === "application/vnd.google-apps.document") return `https://docs.google.com/document/d/${entry.id}/edit`;
  return `https://drive.google.com/file/d/${entry.id}/view`;
}
