// Read-only Cloudflare CPU summary for the isolated import Worker. Never print credentials.
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

const accountId = "6bbc3dae7e111660f0c835677ceffb69";
const worker = "docentetuc-import-canary-1-2";
const from = new Date(process.argv[2] || Date.now() - 15 * 60_000);
const to = new Date(process.argv[3] || Date.now());
if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) ||
    from >= to || to.getTime() - from.getTime() > 60 * 60_000)
  throw new Error("CANARY_METRIC_WINDOW_INVALID");

const log = resolve(".wrangler/import-canary-auth.log");
let token;
try {
  const output = execFileSync(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "auth", "token"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, WRANGLER_LOG_PATH: log },
  });
  const matches = output.match(/cfoat_[A-Za-z0-9._-]+/g) || [];
  if (matches.length !== 1) throw new Error("WRANGLER_AUTH_UNAVAILABLE");
  token = matches[0];
} catch { throw new Error("WRANGLER_AUTH_UNAVAILABLE"); }
finally { rmSync(log, { force: true }); }

const query = `query CanaryCpu($accountTag: string, $start: string, $end: string, $scriptName: string) {
  viewer { accounts(filter: {accountTag: $accountTag}) {
    workersInvocationsAdaptive(limit: 100, filter: {
      scriptName: $scriptName, datetime_geq: $start, datetime_leq: $end
    }) {
      dimensions { datetime status }
      sum { requests errors subrequests }
      quantiles { cpuTimeP50 cpuTimeP99 }
    }
  } }
}`;
let response;
try {
  response = await fetch("https://api.cloudflare.com/client/v4/graphql", {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { accountTag: accountId, scriptName: worker,
      start: from.toISOString(), end: to.toISOString() } }), signal: AbortSignal.timeout(20_000),
  });
} catch { throw new Error("CANARY_METRIC_TRANSPORT_UNAVAILABLE"); }
token = undefined;
if (!response.ok) throw new Error(`CANARY_METRIC_HTTP_${response.status}`);
const data = await response.json();
if (data.errors?.length) throw new Error("CANARY_METRIC_QUERY_REJECTED");
const rows = data.data?.viewer?.accounts?.[0]?.workersInvocationsAdaptive;
if (!Array.isArray(rows)) throw new Error("CANARY_METRIC_RESPONSE_INVALID");
console.log(JSON.stringify({ from: from.toISOString(), to: to.toISOString(), worker,
  rows: rows.map((row) => ({ at: row.dimensions?.datetime, status: row.dimensions?.status,
    requests: row.sum?.requests, errors: row.sum?.errors, subrequests: row.sum?.subrequests,
    cpuP50Ms: row.quantiles?.cpuTimeP50 == null ? null : row.quantiles.cpuTimeP50 / 1000,
    cpuP99Ms: row.quantiles?.cpuTimeP99 == null ? null : row.quantiles.cpuTimeP99 / 1000 })) }));
