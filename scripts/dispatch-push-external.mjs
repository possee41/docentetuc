// One bounded Node dispatch job. Canary and simulated sending are the defaults.
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { dispatchPushNotifications, WebPushProvider } from "../lib/push.ts";
import { createD1Rest } from "./d1-rest.mjs";
import { resolveDirectD1Target, verifyDirectD1Identity } from "./import-direct-d1.mjs";

export function resolveExternalPushConfig(config, revision = "") {
  if (config.EXTERNAL_PUSH_ENABLED !== "true" || config.DIRECT_D1_WRITE_ENABLED !== "true")
    throw new Error("EXTERNAL_PUSH_DISABLED");
  const target = resolveDirectD1Target(config, revision);
  const mode = config.PUSH_SEND_MODE || "simulated";
  if (mode === "simulated" && config.DIRECT_D1_TARGET !== "production") return { target, mode };
  if (mode !== "real" || config.PUSH_REAL_SEND_ENABLED !== "true" ||
      config.DIRECT_D1_TARGET !== "production" ||
      config.PUSH_DISPATCH_MODE !== "external" ||
      !config.VAPID_PUBLIC_KEY || !config.VAPID_PRIVATE_KEY || !config.VAPID_SUBJECT)
    throw new Error("EXTERNAL_PUSH_MODE_INVALID");
  return { target, mode };
}

export async function runExternalPushDispatch(db, environment, provider, { maxSteps = 5, now = () => new Date() } = {}) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 10 ||
      !provider || typeof provider.send !== "function") throw new Error("EXTERNAL_PUSH_STEP_INVALID");
  const total = { steps: 0, considered: 0, sent: 0, failed: 0, removed: 0, deferred: 0 };
  for (let index = 0; index < maxSteps; index++) {
    const result = await dispatchPushNotifications(db, environment, now(), provider);
    total.steps++;
    for (const key of ["considered", "sent", "failed", "removed", "deferred"])
      total[key] += result[key];
    if (!result.considered || result.deferred === result.considered) break;
  }
  return total;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const revision = process.env.DIRECT_D1_TARGET === "production"
      ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    const { target, mode } = resolveExternalPushConfig(process.env, revision);
    const accountId = process.env.CF_ACCOUNT_ID, token = process.env.PUSH_D1_TOKEN;
    // Identity must be checked before any SQL or provider call.
    await verifyDirectD1Identity({ accountId, token, target });
    const db = createD1Rest({ accountId, databaseId: target.id, token });
    const environment = mode === "real" ? process.env : {
      VAPID_PUBLIC_KEY: "synthetic", VAPID_PRIVATE_KEY: "synthetic", VAPID_SUBJECT: "mailto:canary@example.invalid",
    };
    const provider = mode === "real"
      ? new WebPushProvider({ publicKey: environment.VAPID_PUBLIC_KEY,
        privateKey: environment.VAPID_PRIVATE_KEY, subject: environment.VAPID_SUBJECT })
      : { send: async () => new Response(null, { status: 201 }) };
    const result = await runExternalPushDispatch(db, environment, provider);
    console.log(JSON.stringify({ mode, ...result, d1: db.metrics() }));
    if (result.failed) process.exitCode = 1;
  } catch {
    // Remote responses, subscription endpoints and secrets never enter logs.
    console.error("EXTERNAL_PUSH_DISPATCH_FAILED");
    process.exitCode = 1;
  }
}
