import { deviceUser } from "./device-user.ts";

export const INSTALLATION_PROOF_COOKIE = "docentetuc_installation_proof";
const COOKIE_PATHS = [
  "/api/app", "/api/ai", "/api/sync", "/api/push",
  "/api/auth/link", "/api/auth/delete-account", "/api/installations",
];

type Database = {
  prepare(sql: string): { bind(...values: (string | number)[]): { first<T>(): Promise<T | null> } };
};

export type InstallationProof = "missing" | "valid" | "invalid";

export function readInstallationProof(request: Request) {
  const prefix = `${INSTALLATION_PROOF_COOKIE}=`;
  const value = request.headers.get("cookie")?.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix))?.slice(prefix.length);
  return value && /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}

export async function hashInstallationSecret(secret: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function createInstallationSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function sameSecretHash(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
}

export async function installationProofFor(database: Database, request: Request, deviceId: string): Promise<InstallationProof> {
  const row = await database.prepare("SELECT secret_hash FROM installation_credentials WHERE device_id=?").bind(deviceId).first<{ secret_hash: string }>();
  if (!row) return "missing";
  const secret = readInstallationProof(request);
  if (!secret) return "invalid";
  return sameSecretHash(row.secret_hash, await hashInstallationSecret(secret)) ? "valid" : "invalid";
}

/** Recover a lost local ID only when the installation still presents its private proof cookie. */
export async function installationIdForProof(database: Database, request: Request) {
  const secret = readInstallationProof(request);
  if (!secret) return null;
  const row = await database.prepare("SELECT device_id FROM installation_credentials WHERE secret_hash=?")
    .bind(await hashInstallationSecret(secret)).first<{ device_id: string }>();
  return row && deviceUser(row.device_id) ? row.device_id : null;
}

export function installationProofCookies(request: Request, secret: string, clear = false) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  const value = clear ? "" : secret;
  const age = clear ? 0 : 34560000;
  return COOKIE_PATHS.map((path) => `${INSTALLATION_PROOF_COOKIE}=${value}; Path=${path}; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`);
}

/** Checks all existing device-scoped user data before rotating a legacy ID. */
export async function installationHasData(database: Database, deviceId: string) {
  const userId = deviceUser(deviceId)?.userId;
  if (!userId) return true;
  const sql = `SELECT
    EXISTS(SELECT 1 FROM profiles WHERE user_id=? AND (COALESCE(name,'Docente')<>'Docente' OR COALESCE(email,'')<>'' OR COALESCE(level,'')<>'' OR COALESCE(area,'')<>'' OR COALESCE(subjects,'')<>'' OR COALESCE(junta,'')<>'' OR COALESCE(roles,'')<>'' OR COALESCE(department,'')<>'' OR COALESCE(locality,'')<>'' OR COALESCE(shifts,'')<>'' OR COALESCE(wants_interim,1)<>1 OR COALESCE(wants_substitute,1)<>1 OR COALESCE(training_interests,'')<>'' OR COALESCE(characters,'')<>'' OR COALESCE(circuits,'')<>'' OR COALESCE(personal_match_threshold,85)<>85 OR COALESCE(notify_new_trainings,0)<>0 OR COALESCE(training_notify_scope,'relevant')<>'relevant' OR COALESCE(training_match_threshold,80)<>80)) OR
    EXISTS(SELECT 1 FROM public_profiles WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM saved_publications WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM notifications WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM training_reminders WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM designation_tracking WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM manual_events WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM manual_event_push_queue WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM push_preferences WHERE user_id=?) OR
    EXISTS(SELECT 1 FROM push_subscriptions WHERE user_id=? OR device_id=?) OR
    EXISTS(SELECT 1 FROM ai_rate_limits WHERE substr(user_bucket,1,length(?) + 1)=? || ':') OR
    EXISTS(SELECT 1 FROM push_rate_limits WHERE substr(user_bucket,1,length(?) + 1)=? || ':') AS has_data`;
  const row = await database.prepare(sql).bind(...Array(9).fill(userId), userId, deviceId, userId, userId, userId, userId).first<{ has_data: number }>();
  return Number(row?.has_data) !== 0;
}

/** Exact deletion scope for one proven, unlinked installation. */
export function installationDataDeletionStatements(deviceId: string) {
  const userId = deviceUser(deviceId)?.userId;
  if (!userId) throw new Error("Invalid installation identity");
  const unlinked = " AND NOT EXISTS (SELECT 1 FROM account_installations WHERE device_id=?)";
  return [
    { sql: `DELETE FROM push_deliveries WHERE endpoint IN (SELECT endpoint FROM push_subscriptions WHERE device_id=? OR user_id=?)${unlinked}`, values: [deviceId, userId, deviceId] },
    { sql: `DELETE FROM manual_event_push_queue WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM push_subscriptions WHERE (device_id=? OR user_id=?)${unlinked}`, values: [deviceId, userId, deviceId] },
    { sql: `DELETE FROM push_preferences WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM notifications WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM training_reminders WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM designation_tracking WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM saved_publications WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM manual_events WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM ai_rate_limits WHERE substr(user_bucket,1,length(?) + 1)=? || ':'${unlinked}`, values: [userId, userId, deviceId] },
    { sql: `DELETE FROM push_rate_limits WHERE substr(user_bucket,1,length(?) + 1)=? || ':'${unlinked}`, values: [userId, userId, deviceId] },
    { sql: `DELETE FROM public_profiles WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM profiles WHERE user_id=?${unlinked}`, values: [userId, deviceId] },
    { sql: `DELETE FROM installation_credentials WHERE device_id=?${unlinked}`, values: [deviceId, deviceId] },
  ];
}

export function changedRows(result: unknown) {
  const changes = (result as { meta?: { changes?: unknown } } | null)?.meta?.changes;
  return typeof changes === "number" ? changes : 0;
}

export function installationDeletionConfirmed(responseOk: boolean, result: { installationDataDeleted?: unknown } | null) {
  return responseOk && result?.installationDataDeleted === true;
}
