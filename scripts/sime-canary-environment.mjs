// Read-only preflight. Deliberately independent of the import secret and Environment.
import { execFileSync } from "node:child_process";
import { readFileSync, appendFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const repo = "possee41/docentetuc", branch = "pilot/sime-fair-canary", environment = "canary-sime";
const fail = code => { throw new Error(code); };
const id = value => typeof value === "string" && /^[1-9]\d*$/.test(value) && Number.isSafeInteger(Number(value));

export async function verifyCanaryEnvironment(config, revision, fetcher = fetch) {
  if (config.GITHUB_REPOSITORY !== repo || config.GITHUB_REF !== `refs/heads/${branch}` ||
      config.GITHUB_EVENT_NAME !== "workflow_dispatch" || config.GITHUB_RUN_ATTEMPT !== "1" ||
      config.IMPORT_GATEWAY_TARGET !== "canary" || config.SIME_IMPORT_JUNTAS !== "1,2,3,4" ||
      config.SIME_IMPORT_LIMIT !== "50" || config.SIME_IMPORT_RESUME_AFTER !== "" ||
      !id(config.GITHUB_RUN_ID) || !id(config.SIME_CANARY_OWNER_ID) || !id(config.SIME_CANARY_ENVIRONMENT_ID) ||
      !/^[a-f0-9]{40}$/.test(config.SIME_CANARY_APPROVED_SHA || "") ||
      revision !== config.SIME_CANARY_APPROVED_SHA || config.GITHUB_SHA !== revision ||
      typeof config.GH_TOKEN !== "string" || !config.GH_TOKEN || /[\r\n]/.test(config.GH_TOKEN))
    fail("SIME_ENV_PREFLIGHT_NOT_APPROVED");
  const base = `https://api.github.com/repos/${repo}`;
  const get = async path => {
    const response = await fetcher(base + path, { method: "GET", redirect: "error",
      signal: AbortSignal.timeout(20_000), headers: { Authorization: `Bearer ${config.GH_TOKEN}`,
        Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2026-03-10" } });
    if (response.status !== 200) fail(`SIME_ENV_PREFLIGHT_HTTP_${response.status}`);
    try {
      const value = await response.json();
      if (!value || typeof value !== "object" || Array.isArray(value)) fail("SIME_ENV_PREFLIGHT_RESPONSE_INVALID");
      return value;
    } catch { fail("SIME_ENV_PREFLIGHT_RESPONSE_INVALID"); }
  };
  const ownerId = Number(config.SIME_CANARY_OWNER_ID);
  const repository = await get("");
  if (repository.full_name !== repo || repository.owner?.login !== "possee41" ||
      repository.owner?.id !== ownerId || repository.owner?.type !== "User") fail("SIME_ENV_OWNER_MISMATCH");
  const run = await get(`/actions/runs/${config.GITHUB_RUN_ID}`);
  if (run.id !== Number(config.GITHUB_RUN_ID) || run.event !== "workflow_dispatch" || run.run_attempt !== 1 ||
      run.head_sha !== revision || run.head_branch !== branch || run.repository?.full_name !== repo ||
      run.actor?.id !== ownerId || run.triggering_actor?.id !== ownerId ||
      run.path !== ".github/workflows/sime-import.yml") fail("SIME_ENV_RUN_MISMATCH");
  const head = await get(`/git/ref/heads/${branch}`);
  if (head.ref !== `refs/heads/${branch}` || head.object?.type !== "commit" || head.object.sha !== revision)
    fail("SIME_ENV_REVISION_MISMATCH");
  // The approved SHA also fixes the permission declarations; no write probes or token extraction.
  const file = await get(`/contents/.github/workflows/sime-import.yml?ref=${revision}`);
  if (file.encoding !== "base64" || typeof file.content !== "string" ||
      !Buffer.from(file.content, "base64").equals(readFileSync(new URL("../.github/workflows/sime-import.yml", import.meta.url))))
    fail("SIME_ENV_WORKFLOW_MISMATCH");
  const env = await get(`/environments/${environment}`);
  const required = env.protection_rules?.filter(rule => rule.type === "required_reviewers");
  if (env.name !== environment || env.id !== Number(config.SIME_CANARY_ENVIRONMENT_ID) ||
      env.url !== `${base}/environments/${environment}` || required?.length !== 1 ||
      required[0].prevent_self_review !== false || required[0].reviewers?.length !== 1 ||
      required[0].reviewers[0].type !== "User" || required[0].reviewers[0].reviewer?.id !== ownerId ||
      required[0].reviewers[0].reviewer?.login !== "possee41" || env.can_admins_bypass !== false ||
      env.deployment_branch_policy?.protected_branches !== false ||
      env.deployment_branch_policy?.custom_branch_policies !== true)
    fail("SIME_ENV_PROTECTIONS_UNVERIFIED");
  const policies = await get(`/environments/${environment}/deployment-branch-policies?per_page=100`);
  if (policies.total_count !== 1 || policies.branch_policies?.length !== 1 ||
      policies.branch_policies[0].name !== branch || policies.branch_policies[0].type !== "branch")
    fail("SIME_ENV_BRANCH_POLICY_INVALID");
  const result = { ready: true, codeSha: revision, runId: config.GITHUB_RUN_ID, ownerId,
    environment, environmentId: env.id,
    policyChecksum: createHash("sha256").update(JSON.stringify({ rules: env.protection_rules,
      bypass: env.can_admins_bypass, policy: env.deployment_branch_policy, branches: policies.branch_policies })).digest("hex") };
  if (Object.hasOwn(config, "SIME_CANARY_PREFLIGHT_CHECKSUM") &&
      (!/^[a-f0-9]{64}$/.test(config.SIME_CANARY_PREFLIGHT_CHECKSUM || "") ||
       config.SIME_CANARY_PREFLIGHT_CHECKSUM !== result.policyChecksum)) fail("SIME_ENV_CHANGED_SINCE_PREFLIGHT");
  return result;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    const result = await verifyCanaryEnvironment(process.env, revision);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT,
      `ready=true\nenvironment_id=${result.environmentId}\npolicy_checksum=${result.policyChecksum}\ncode_sha=${result.codeSha}\n`);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(/^SIME_[A-Z0-9_]+$/.test(error?.message || "") ? error.message : "SIME_ENV_PREFLIGHT_FAILED");
    process.exitCode = 1;
  }
}
