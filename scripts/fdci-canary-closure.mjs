// Operator helper only: no network, credentials or remote action at module load.
export function oauthEnvironment(env) {
  const clean = { ...env };
  for (const key of ["CLOUDFLARE_API_TOKEN", "CF_API_TOKEN", "CLOUDFLARE_API_KEY", "CF_API_KEY", "CLOUDFLARE_EMAIL", "CF_EMAIL"])
    delete clean[key];
  return clean;
}

export function freshOAuth(run) {
  // whoami lets Wrangler refresh its existing OAuth session. Never inject a
  // cached OAuth token as an API token into this or later Wrangler children.
  if (run(["whoami", "--json"]).status !== 0) throw Error("OAUTH_REFRESH_UNAVAILABLE");
  const result = run(["auth", "token", "--json"]);
  let credentials;
  try { credentials = JSON.parse(result.stdout); } catch { /* fail closed */ }
  if (result.status !== 0 || credentials?.type !== "oauth" || !credentials.token)
    throw Error("OAUTH_UNAVAILABLE");
  return credentials.token;
}

export async function closeCanary(steps) {
  const failures = [];
  // Each operation must check the fixed canary identity and use fresh auth.
  // No write retries: after an ambiguous result continue independent barriers,
  // then inspect the actual state. An earlier failure cannot skip cleanup.
  for (const name of ["disableExposure", "haltAndExpire", "deployClosed", "removeSecret", "verifyClosed"]) {
    try { await steps[name](); } catch { failures.push(name); }
  }
  return { verified: !failures.includes("verifyClosed"), failures };
}

// Fixed target for the pending-candidate experiment; not a general admin tool.
// The private adapter supplies authenticated, allowlisted I/O and its final
// verification of exposure, flags, secrets, leases, HALTED and unchanged data.
export async function closePendingCanary(admin, config) {
  const name = "docentetuc-fdci-functional-canary-1-2", id = "3e84a257-cbac-4023-a0a3-148a3441dd62";
  if (config.name !== name || config.account_id !== "6bbc3dae7e111660f0c835677ceffb69" || config.main !== "workers/source-import-gateway.mjs" ||
      config.d1_databases?.length !== 1 || config.d1_databases[0].database_id !== id ||
      config.d1_databases[0].database_name !== name || config.d1_databases[0].binding !== "DB" ||
      config.vars?.IMPORT_DATABASE_ID !== id || config.vars.IMPORT_DATABASE_NAME !== name || config.vars.IMPORT_GATE_ALLOWED_SOURCE !== "fdci" ||
      config.workers_dev !== false || config.preview_urls !== false || config.routes?.length !== 0 || config.triggers?.crons?.length !== 0 ||
      !["IMPORT_GATE_ENABLED", "IMPORT_GATE_LEASE_REQUIRED", "FDCI_EXTERNAL_ENABLED", "FDCI_AUTOMATION_ENABLED", "FDCI_DELTA_ENABLED"].every(k => config.vars[k] === "false"))
    throw Error("CLOSE_CONFIG_INVALID");
  const configArgs = ["--config", "wrangler.1.2-fdci-functional-canary.jsonc"];
  return closeCanary({
    async disableExposure() {
      await admin.auth();
      await admin.api(`/workers/scripts/${name}/subdomain`, { method: "POST", body: { enabled: false, previews_enabled: false } });
    },
    async haltAndExpire() {
      await admin.auth();
      await admin.sql("UPDATE fdci_automation_control SET status='HALTED',halt_reason='CANARY_TEST_FINISHED' WHERE id=1; UPDATE import_gate_lease SET expires_at=strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id=1 AND source='fdci';", "operator-close-canary-only");
    },
    async deployClosed() {
      await admin.auth();
      if (admin.run(["deploy", ...configArgs]).status !== 0) throw Error("CLOSE_DEPLOY_UNCERTAIN");
    },
    async removeSecret() {
      await admin.auth();
      const m = await admin.metadata();
      if (m.settings.bindings.some(x => x.name === "FDCI_AUTOMATION_SECRET") &&
          admin.run(["secret", "delete", "FDCI_AUTOMATION_SECRET", ...configArgs]).status !== 0)
        throw Error("SECRET_DELETE_UNCONFIRMED");
    },
    async verifyClosed() { await admin.auth(); await admin.verifyClosed(); },
  });
}
