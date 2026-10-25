import { pathToFileURL } from "node:url";
import { collectJuntaExternal } from "../lib/junta-external.ts";
import { JUNTA_EXTERNAL_SOURCES } from "../lib/junta-external-sources.ts";
import { isCenetMarkupRecognized, parseCenetTrainings, parseInfdCatalog, parseInfdTrainings, parseInfdWebinars } from "../lib/external-trainings.ts";
import { prepareJuntaImport, prepareTrainingImport } from "../lib/public-source-import.ts";
import { sourceErrorCode } from "../lib/publication-lifecycle.ts";

const urls = { cenet: "https://cenet.inet.edu.ar/mod/page/view.php?id=30493", infd: "https://red.infd.edu.ar/cursos-nacionales-2/" };
async function getText(url, fetcher) {
  const response = await fetcher(url, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`SOURCE_HTTP_${response.status}`);
  return response.text();
}
async function send(endpoint, token, payload, fetcher) {
  const response = await fetcher(endpoint, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload), signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`RECEIVER_HTTP_${response.status}`);
  const ack = await response.json();
  if (ack.ok !== true) throw new Error("RECEIVER_ACK_INVALID");
  return ack;
}
export async function runPublicSourceImport({ source, endpoint, token, driveKey, sourceFetch = fetch, receiverFetch = fetch,
  now = new Date(), juntaSources }) {
  let target;
  try { target = new URL(endpoint); } catch { throw new Error("IMPORT_CONFIGURATION_INVALID"); }
  if (!["juntas", "cenet", "infd"].includes(source) || target.pathname !== `/api/internal/public-source-import/${source}` ||
      (target.protocol !== "https:" && !(target.protocol === "http:" && target.hostname === "127.0.0.1")) ||
      !/^[A-Za-z0-9_-]{32,}$/.test(token)) throw new Error("IMPORT_CONFIGURATION_INVALID");
  const health = source === "juntas" ? [...new Set((juntaSources || JUNTA_EXTERNAL_SOURCES).map((root) => root[1]))] :
    [source === "cenet" ? "CeNET / INET" : "INFoD / AulaS-TIC"];
  await send(endpoint, token, { mode: "start", health }, receiverFetch);
  const result = { discovered: 0, created: 0, updated: 0, unchanged: 0, queries: 0, rowsRead: 0, rowsWritten: 0 };
  const counts = Object.fromEntries(health.map((name) => [name, 0]));
  const apply = async (items, sourceCategory) => {
    for (const item of items) {
      const row = source === "juntas" ? await prepareJuntaImport(item, now) :
        await prepareTrainingImport(item, source === "cenet" ? "CeNET / INET" : "INFoD / AulaS-TIC", now);
      // One item per request matches the measured narrow receiver path; five remains the hard API ceiling.
      const ack = await send(endpoint, token, { mode: "batch", items: [row] }, receiverFetch);
      if (ack.received !== 1 || ack.created + ack.updated + ack.unchanged !== 1) throw new Error("RECEIVER_ACK_INVALID");
      result.discovered++;
      if (sourceCategory) counts[sourceCategory]++;
      for (const field of ["created", "updated", "unchanged", "queries", "rowsRead", "rowsWritten"]) result[field] += ack[field];
    }
  };
  try {
    if (source === "juntas") {
      const scan = await collectJuntaExternal({ fetcher: sourceFetch, driveKey, sources: juntaSources, onItems: apply });
      const failed = new Set(scan.failures.map((item) => item.category));
      for (const name of health) await send(endpoint, token, failed.has(name)
        ? { mode: "error", health: [name], code: "PARTIAL" }
        : { mode: "finish", health: [name], complete: true, count: counts[name] }, receiverFetch);
      if (scan.failures.length) {
        const error = new Error("JUNTAS_PARTIAL_SOURCE");
        error.failures = scan.failures;
        throw error;
      }
      return { ...result, completed: true };
    } else if (source === "cenet") {
      const html = await getText(urls.cenet, sourceFetch);
      if (!isCenetMarkupRecognized(html)) throw new Error("CENET_FORMAT_CHANGED");
      const items = parseCenetTrainings(html, now);
      if (!items.length) throw new Error("CENET_EMPTY_SUSPECT");
      await apply(items);
    } else {
      const html = await getText(urls.infd, sourceFetch), catalog = parseInfdCatalog(html, now);
      if (!catalog.pages.length) throw new Error("INFD_FORMAT_CHANGED");
      let failed = false;
      for (const page of catalog.pages) {
        try {
          const pageHtml = await getText(page, sourceFetch);
          await apply(page.includes("/webinarios/") ? parseInfdWebinars(pageHtml, page, now) : parseInfdTrainings(pageHtml, page, catalog, now));
        } catch { failed = true; }
      }
      if (failed || !result.discovered) throw new Error(failed ? "INFD_PARTIAL_SOURCE" : "INFD_EMPTY_SUSPECT");
    }
    await send(endpoint, token, { mode: "finish", health, complete: true, count: result.discovered }, receiverFetch);
    return { ...result, completed: true };
  } catch (error) {
    if (source === "juntas" && error instanceof Error && error.message === "JUNTAS_PARTIAL_SOURCE") throw error;
    const message = error instanceof Error ? error.message : "";
    const code = /PARTIAL_SOURCE|JUNTAS_DOCUMENT_UNAVAILABLE/.test(message) ? "PARTIAL" :
      /FORMAT_CHANGED|NOTICE_FORMAT_UNRECOGNIZED/.test(message) ? "FORMAT_CHANGED" :
      /EMPTY_SUSPECT/.test(message) ? "EMPTY_SUSPECT" : sourceErrorCode(error);
    try { await send(endpoint, token, { mode: "error", health, code }, receiverFetch); } catch { /* Keep original failure. */ }
    throw error;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const source = process.env.PUBLIC_SOURCE || "";
    const result = await runPublicSourceImport({ source, endpoint: process.env.PUBLIC_IMPORT_URL || "",
      token: process.env.PUBLIC_IMPORT_SECRET || "", driveKey: process.env.GOOGLE_DRIVE_API_KEY });
    console.log(JSON.stringify({ source, ...result }));
  } catch (error) {
    console.error("PUBLIC_IMPORT_FAILED", sourceErrorCode(error), error?.failures || "");
    process.exitCode = 1;
  }
}
