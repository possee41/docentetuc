// Read a manual Workers Logs JSON export. Prints only technical invocation fields.
import { readFileSync, statSync } from "node:fs";
import { pathToFileURL } from "node:url";

const worker = "docentetuc-import-canary-1-2";
const from = Date.parse("2026-10-28T04:28:40Z");
const to = Date.parse("2026-10-28T04:29:01Z");
const expected = new Map([
  ["/api/internal/import-identity", 1],
  ["/api/internal/juntas-checkpoint", 12],
  ["/api/internal/public-source-import/juntas", 1],
]);
const field = (row, nested, flat) => nested ?? row[flat] ?? null;
const instant = (value) => typeof value === "number" ? value : Date.parse(value || "");
const path = (value) => {
  if (typeof value !== "string") return null;
  const match = value.match(/(?:GET|POST)\s+(\S+)/);
  try { return new URL(match?.[1] || value, "https://canary.invalid").pathname; }
  catch { return null; }
};
const records = (body) => Array.isArray(body) ? body :
  body?.result?.events?.events || body?.events?.events || body?.events || body?.records || body?.data || [];

export function reconcileJuntasLogs(rawRows) {
  if (!Array.isArray(rawRows)) throw new Error("JUNTAS_LOG_FORMAT_INVALID");
  const rows = rawRows.flatMap((row) => {
    const meta = row?.$metadata || row?.metadata || {};
    const invocation = row?.$workers || row?.workers || {};
    const service = field(row, meta.service || invocation.scriptName, "$metadata.service");
    if (service && service !== worker) return [];
    const at = instant(row?.timestamp ?? meta.timestamp ?? row?.["$metadata.timestamp"]);
    if (!Number.isFinite(at) || at < from || at > to) return [];
    const route = [meta.trigger, meta.url, invocation.event?.request?.url,
      row?.["$metadata.trigger"], row?.["$metadata.url"], row?.url].map(path).find((candidate) => expected.has(candidate));
    if (!expected.has(route)) return [];
    const cpu = field(row, invocation.cpuTimeMs, "$workers.cpuTimeMs");
    const outcome = field(row, invocation.outcome, "$workers.outcome");
    const http = field(row, meta.statusCode ?? invocation.event?.response?.status, "$metadata.statusCode");
    const requestId = meta.requestId || invocation.requestId || row?.["$metadata.requestId"] || null;
    const eventId = meta.id || row?.["$metadata.id"] || null;
    return [{ at: new Date(at).toISOString(), route, requestId, eventId,
      cpuTimeMs: cpu === null ? null : Number(cpu), outcome, http: http === null ? null : Number(http) }];
  });
  // The export can contain console lines as well as the invocation event.
  const invocations = [...new Map(rows.filter((row) => row.cpuTimeMs !== null)
    .map((row, index) => [row.requestId || row.eventId || `${row.at}:${row.route}:${index}`, row])).values()]
    .sort((a, b) => a.at.localeCompare(b.at));
  const byRoute = Object.fromEntries([...expected].map(([route]) =>
    [route, invocations.filter((row) => row.route === route).length]));
  const missing = Object.fromEntries([...expected].map(([route, count]) => [route, Math.max(0, count - byRoute[route])]));
  const complete = invocations.length === 14 && [...expected].every(([route, count]) => byRoute[route] === count) &&
    invocations.every((row) => Number.isFinite(row.cpuTimeMs) && row.outcome === "ok" && row.http === 200);
  return { runId: null, expected: 14, found: invocations.length, byRoute, missing,
    maxCpuTimeMs: invocations.length ? Math.max(...invocations.map((row) => row.cpuTimeMs)) : null,
    readyForResume: complete && invocations.every((row) => row.cpuTimeMs <= 7), invocations };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const filename = process.argv[2];
  if (!filename || statSync(filename).size > 10_000_000) throw new Error("JUNTAS_LOG_FILE_INVALID");
  const raw = readFileSync(filename, "utf8");
  let data;
  try { data = records(JSON.parse(raw)); }
  catch { data = raw.trim().split(/\r?\n/).map((line) => JSON.parse(line)); }
  console.log(JSON.stringify(reconcileJuntasLogs(data), null, 2));
}
