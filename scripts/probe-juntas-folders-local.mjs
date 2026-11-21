// Read-only preflight for the six configured public Drive folders.
// Never log the API key, Drive IDs, resource keys, or page tokens.
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { listDrivePage } from "../lib/junta-external.ts";

const key = process.env.GOOGLE_DRIVE_API_KEY;
if (!key) throw new Error("GOOGLE_DRIVE_API_KEY_NOT_SET");

const folders = JUNTA_EXTERNAL_SOURCES.filter(([, , , url]) => url.startsWith("https://drive.google.com/drive/folders/"));
if (folders.length !== 6) throw new Error("JUNTAS_FOLDER_CONFIGURATION_CHANGED");

for (const [name, category, junta, address] of folders) {
  try {
    const url = new URL(address);
    const folderId = url.pathname.split("/").at(-1);
    const resourceKey = url.searchParams.get("resourcekey") || undefined;
    const first = await listDrivePage(folderId, key, resourceKey);
    let secondCount = 0;
    if (first.nextPageToken) {
      const second = await listDrivePage(folderId, key, resourceKey, first.nextPageToken);
      const firstIds = new Set(first.files.map((file) => file.id));
      if (second.files.some((file) => firstIds.has(file.id))) throw new Error("JUNTAS_DUPLICATE_PAGE_ID");
      secondCount = second.files.length;
    }
    console.log(JSON.stringify({ folder: name, category, junta, firstCount: first.files.length,
      secondCount, nextPageTokenPresent: Boolean(first.nextPageToken), requests: secondCount ? 2 : 1, ok: true }));
  } catch (error) {
    console.log(JSON.stringify({ folder: name, category, junta, ok: false,
      error: error instanceof Error ? error.message.replace(/https?:\/\/\S+/g, "[url]") : "UNKNOWN" }));
    process.exitCode = 1;
  }
}
