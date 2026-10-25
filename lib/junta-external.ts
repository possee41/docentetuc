import { JUNTA_EXTERNAL_SOURCES } from "./junta-external-sources.ts";
import { driveEntryUrl, plainDocumentText } from "./public-documents.ts";
import { classifyDriveReference, documentReference, extractJuntaNotices } from "./junta-notices.ts";
import type { CollectedPublication } from "./official-publication.ts";

type Fetcher = typeof fetch;
const folderMime = "application/vnd.google-apps.folder";
const docMime = "application/vnd.google-apps.document";
const networkCode = (error: unknown) => error instanceof Error && /timeout|abort/i.test(`${error.name} ${error.message}`)
  ? "JUNTAS_SOURCE_TIMEOUT" : "JUNTAS_SOURCE_NETWORK";
const recoverableSourceError = (error: unknown) => error instanceof Error &&
  /^JUNTAS_(?:HTTP_\d+|DRIVE_HTTP_\d+|DRIVE_PAGE_INVALID|DRIVE_JSON_INVALID|NOTICE_FORMAT_UNRECOGNIZED|SOURCE_TIMEOUT|SOURCE_NETWORK|DOCUMENT_FORMAT_INVALID)$/.test(error.message);

async function responseText(url: string, fetcher: Fetcher) {
  let response: Response;
  try { response = await fetcher(url, { signal: AbortSignal.timeout(20_000) }); }
  catch (error) { throw new Error(networkCode(error)); }
  if (!response.ok) throw new Error(`JUNTAS_HTTP_${response.status}`);
  try { return await response.text(); }
  catch (error) { throw new Error(networkCode(error)); }
}
function reference(id: string, category: string, junta: string, url: string, title: string,
  sourceUpdatedAt: string | null = null): CollectedPublication {
  return { id, source: "Padrones y Comunicados", externalId: id, kind: "junta", category, junta, title,
    summary: "Documento público de Junta; consultar la fuente para verificar su vigencia.", level: "", area: "",
    location: "", shift: "", character: "", startsAt: null, endsAt: null, status: "Documento público · vigencia no informada",
    officialUrl: url, metadata: "{}", contentHash: "", sourceUpdatedAt };
}
export async function listDrivePage(folderId: string, key: string,
  resourceKey: string | readonly { id: string; key: string }[] | undefined, pageToken = "", fetcher: Fetcher = fetch,
  filesOnly = false) {
  if (!/^[A-Za-z0-9_-]{10,}$/.test(folderId) || !/^[A-Za-z0-9_-]{10,}$/.test(key)) throw new Error("JUNTAS_DRIVE_CONFIGURATION_INVALID");
  const url = new URL("https://www.googleapis.com/drive/v3/files");
  url.searchParams.set("q", `'${folderId}' in parents and trashed = false${filesOnly ? " and mimeType != 'application/vnd.google-apps.folder'" : ""}`);
  url.searchParams.set("pageSize", "25");
  url.searchParams.set("fields", "nextPageToken,incompleteSearch,files(id,name,mimeType,modifiedTime,resourceKey)");
  url.searchParams.set("supportsAllDrives", "true");
  url.searchParams.set("includeItemsFromAllDrives", "true");
  if (pageToken) url.searchParams.set("pageToken", pageToken);
  const headers: Record<string, string> = { "x-goog-api-key": key, Accept: "application/json" };
  if (Array.isArray(resourceKey)) {
    if (resourceKey.some((entry) => !/^[A-Za-z0-9_-]+$/.test(entry.id) || !/^[A-Za-z0-9_-]+$/.test(entry.key)))
      throw new Error("JUNTAS_DRIVE_CONFIGURATION_INVALID");
    if (resourceKey.length) headers["X-Goog-Drive-Resource-Keys"] = resourceKey.map((entry) => `${entry.id}/${entry.key}`).join(",");
  } else if (resourceKey) headers["X-Goog-Drive-Resource-Keys"] = `${folderId}/${resourceKey}`;
  let response: Response;
  try { response = await fetcher(url, { headers, signal: AbortSignal.timeout(20_000) }); }
  catch (error) { throw new Error(networkCode(error)); }
  if (!response.ok) {
    if (response.status === 400 && pageToken) {
      const body = await response.json().catch(() => null) as { error?: { errors?: { reason?: string }[] } } | null;
      if (body?.error?.errors?.some((item) => item.reason === "invalidPageToken"))
        throw new Error("JUNTAS_DRIVE_PAGE_TOKEN_EXPIRED");
    }
    throw new Error(`JUNTAS_DRIVE_HTTP_${response.status}`);
  }
  let data: { incompleteSearch?: boolean; nextPageToken?: string; files?: { id: string; name: string; mimeType: string; modifiedTime?: string; resourceKey?: string }[] };
  try { data = await response.json() as typeof data; }
  catch (error) { throw new Error(networkCode(error) === "JUNTAS_SOURCE_TIMEOUT" ? "JUNTAS_SOURCE_TIMEOUT" : "JUNTAS_DRIVE_JSON_INVALID"); }
  if (data.incompleteSearch || !Array.isArray(data.files) || data.files.length > 25 ||
      data.files.some((file) => !file.id || !file.name || !file.mimeType) ||
      (data.nextPageToken && data.nextPageToken === pageToken)) throw new Error("JUNTAS_DRIVE_PAGE_INVALID");
  return data;
}

export async function collectJuntaExternal({ fetcher = fetch, driveKey, sources = JUNTA_EXTERNAL_SOURCES,
  onItems = async () => {} }: {
  fetcher?: Fetcher; driveKey?: string; sources?: readonly (readonly [string, string, string, string])[];
  onItems?: (items: CollectedPublication[], sourceCategory: string) => Promise<void>;
}) {
  let found = 0, pages = 0;
  const failures: { rootId: string; category: string; code: string }[] = [];
  for (const [rootId, category, junta, officialUrl] of sources) {
    try {
    const root = documentReference(reference(`padrones:${rootId}`, category, junta, officialUrl, `${category} · ${junta}`));
    if (officialUrl.includes("docs.google.com/document/")) {
      const documentId = officialUrl.split("/d/")[1].split("/")[0];
      const raw = await responseText(`https://docs.google.com/document/d/${documentId}/export?format=txt`, fetcher);
      let notices: CollectedPublication[];
      try { notices = extractJuntaNotices(root, raw); }
      catch { throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID"); }
      if (!notices.length) throw new Error("JUNTAS_NOTICE_FORMAT_UNRECOGNIZED");
      root.summary = plainDocumentText(raw, 1800);
      await onItems([root, ...notices], category); found += notices.length + 1;
      continue;
    }
    if (!driveKey) throw new Error("JUNTAS_DRIVE_KEY_REQUIRED");
    const rootUrl = new URL(officialUrl), queue = [{ id: rootUrl.pathname.split("/").at(-1)!, resourceKey: rootUrl.searchParams.get("resourcekey") || undefined }];
    const seenFolders = new Set<string>();
    while (queue.length) {
      const folder = queue.shift()!;
      if (seenFolders.has(folder.id)) continue;
      seenFolders.add(folder.id);
      let token = "";
      do {
        const page = await listDrivePage(folder.id, driveKey, folder.resourceKey, token, fetcher);
        pages++;
        const items: CollectedPublication[] = [];
        for (const file of page.files!) {
          if (file.mimeType === folderMime) { queue.push({ id: file.id, resourceKey: file.resourceKey }); continue; }
          const item = classifyDriveReference(reference(`drive:${rootId}:${file.id}`, category, junta,
            `${driveEntryUrl({ id: file.id, mimeType: file.mimeType })}${file.resourceKey ? `?resourcekey=${encodeURIComponent(file.resourceKey)}` : ""}`,
            file.name, file.modifiedTime || null), file.mimeType);
          items.push(item);
          if (file.mimeType === docMime) {
            try {
              const raw = await responseText(`https://docs.google.com/document/d/${file.id}/export?format=txt`, fetcher);
              items.push(...extractJuntaNotices(item, raw));
            } catch (error) {
              if (items.length) { await onItems(items, category); found += items.length; }
              if (recoverableSourceError(error)) throw error;
              throw new Error("JUNTAS_DOCUMENT_FORMAT_INVALID");
            }
          }
        }
        if (items.length) { await onItems(items, category); found += items.length; }
        token = page.nextPageToken || "";
      } while (token);
    }
    await onItems([root], category); found++;
    } catch (error) {
      if (!recoverableSourceError(error)) throw error;
      failures.push({ rootId, category, code: (error as Error).message });
    }
  }
  return { found, pages, failures };
}
