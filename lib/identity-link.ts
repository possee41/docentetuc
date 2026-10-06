import { deviceUser } from "./device-user.ts";

export type IdentityStatement = { sql: string; values: (string | number | null)[] };
export type IdentityDatabase = {
  prepare(sql: string): {
    bind(...values: (string | number | null)[]): {
      first<T>(): Promise<T | null>;
      run(): Promise<unknown>;
    };
  };
  batch(statements: unknown[]): Promise<unknown>;
};

const PROFILE_COLUMNS = ["name", "email", "level", "area", "subjects", "junta", "roles", "department", "locality", "shifts", "wants_interim", "wants_substitute", "training_interests", "characters", "circuits", "personal_match_threshold", "notify_new_trainings", "training_notify_scope", "training_match_threshold", "updated_at"] as const;
const PROFILE_LIST_COLUMNS = new Set(["level", "area", "subjects", "junta", "roles", "shifts", "training_interests", "characters", "circuits"]);
const PROFILE_DEFAULTS: Record<string, unknown> = { name: "Docente", personal_match_threshold: 85, training_notify_scope: "relevant", training_match_threshold: 80 };

function mergeProfileList(accountValue: unknown, deviceValue: unknown) {
  const values = [accountValue, deviceValue].flatMap((value) => typeof value === "string" ? value.split(/[,;|]/u).map((item) => item.trim()).filter(Boolean) : []);
  const seen = new Set<string>();
  return values.filter((value) => {
    const key = value.normalize("NFC").toLocaleLowerCase("es");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).join(", ");
}

/** Account values take precedence; list preferences are unioned without dropping either installation's selections. */
export function mergePrivateProfileRows(accountRow: Record<string, unknown> | null, deviceRow: Record<string, unknown> | null) {
  if (!deviceRow) return accountRow;
  const merged: Record<string, unknown> = {};
  for (const column of PROFILE_COLUMNS) {
    const accountValue = accountRow?.[column], deviceValue = deviceRow[column];
    if (PROFILE_LIST_COLUMNS.has(column)) merged[column] = mergeProfileList(accountValue, deviceValue);
    else if (accountRow && accountValue != null && accountValue !== "" && accountValue !== PROFILE_DEFAULTS[column]) merged[column] = accountValue;
    else if (deviceValue != null) merged[column] = deviceValue;
    else if (accountValue != null) merged[column] = accountValue;
    else merged[column] = PROFILE_DEFAULTS[column] ?? "";
  }
  return merged;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validInstallationId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export class InstallationLinkError extends Error {
  readonly code: "CONSENT_REQUIRED" | "ALREADY_LINKED" | "LINKED_TO_ANOTHER_ACCOUNT" | "NO_INSTALLATION";
  constructor(code: InstallationLinkError["code"]) {
    super(code);
    this.code = code;
  }
}

const SOURCE_SCOPE = "user_id=?";

export const DEVICE_DATA_COUNTS = [
  { key: "profile", sql: `SELECT COUNT(*) AS count FROM profiles WHERE ${SOURCE_SCOPE} AND (name<>'Docente' OR COALESCE(email,'')<>'' OR level<>'' OR area<>'' OR subjects<>'' OR junta<>'' OR roles<>'' OR department<>'' OR locality<>'' OR shifts<>'' OR wants_interim<>1 OR wants_substitute<>1 OR training_interests<>'' OR characters<>'' OR circuits<>'' OR personal_match_threshold<>85 OR notify_new_trainings<>0 OR training_notify_scope<>'relevant' OR training_match_threshold<>80)` },
  { key: "publicProfile", sql: `SELECT COUNT(*) AS count FROM public_profiles WHERE ${SOURCE_SCOPE}` },
  { key: "saved", sql: `SELECT COUNT(*) AS count FROM saved_publications WHERE ${SOURCE_SCOPE}` },
  { key: "notifications", sql: `SELECT COUNT(*) AS count FROM notifications WHERE ${SOURCE_SCOPE}` },
  { key: "reminders", sql: `SELECT COUNT(*) AS count FROM training_reminders WHERE ${SOURCE_SCOPE}` },
  { key: "designationTracking", sql: `SELECT COUNT(*) AS count FROM designation_tracking WHERE ${SOURCE_SCOPE}` },
  { key: "agendaEvents", sql: `SELECT COUNT(*) AS count FROM manual_events WHERE ${SOURCE_SCOPE}` },
  { key: "pushSubscriptions", sql: `SELECT COUNT(*) AS count FROM push_subscriptions WHERE ${SOURCE_SCOPE}` },
  { key: "pushPreferences", sql: `SELECT COUNT(*) AS count FROM push_preferences WHERE ${SOURCE_SCOPE}` },
] as const;

export async function installationDataPreview(database: IdentityDatabase, accountId: string, deviceId: string) {
  const installation = deviceUser(deviceId);
  if (!installation) throw new InstallationLinkError("NO_INSTALLATION");
  const existing = await database.prepare("SELECT account_id FROM account_installations WHERE device_id=?").bind(deviceId).first<{ account_id: string }>();
  if (existing) {
    if (existing.account_id !== accountId) throw new InstallationLinkError("LINKED_TO_ANOTHER_ACCOUNT");
    return { linked: true as const, hasData: false, dataCategories: [] as string[] };
  }
  const counts = await Promise.all(DEVICE_DATA_COUNTS.map(async ({ key, sql }) => {
    const result = await database.prepare(sql).bind(installation.userId).first<{ count: number }>();
    return [key, Number(result?.count || 0)] as const;
  }));
  const dataCategories = counts.filter(([, count]) => count > 0).map(([key]) => key);
  return { linked: false as const, hasData: dataCategories.length > 0, dataCategories };
}

export function buildInstallationLinkStatements(accountId: string, deviceId: string, mergedProfile?: Record<string, unknown> | null): IdentityStatement[] {
  const sourceUserId = deviceUser(deviceId)?.userId;
  if (!sourceUserId) throw new InstallationLinkError("NO_INSTALLATION");
  const statements: IdentityStatement[] = [
    { sql: "INSERT INTO account_installations (device_id, source_user_id, account_id) VALUES (?, ?, ?)", values: [deviceId, sourceUserId, accountId] },
    { sql: "INSERT OR IGNORE INTO public_profiles (user_id,display_name,avatar_id,bio,updated_at) SELECT ?,display_name,avatar_id,bio,updated_at FROM public_profiles WHERE user_id=?", values: [accountId, sourceUserId] },
    { sql: `INSERT INTO saved_publications (user_id,publication_id,in_agenda,followed,agenda_at,agenda_notes,agenda_reminder_at,agenda_reminder_notified,saved_at)
      SELECT ?,publication_id,in_agenda,followed,agenda_at,agenda_notes,agenda_reminder_at,agenda_reminder_notified,saved_at FROM saved_publications WHERE user_id=?
      ON CONFLICT(user_id,publication_id) DO UPDATE SET
        in_agenda=MAX(saved_publications.in_agenda,excluded.in_agenda),
        followed=MAX(saved_publications.followed,excluded.followed),
        agenda_at=COALESCE(saved_publications.agenda_at,excluded.agenda_at),
        agenda_notes=CASE WHEN saved_publications.agenda_notes='' THEN excluded.agenda_notes WHEN excluded.agenda_notes='' OR saved_publications.agenda_notes=excluded.agenda_notes THEN saved_publications.agenda_notes ELSE substr(saved_publications.agenda_notes || char(10) || excluded.agenda_notes,1,1000) END,
        agenda_reminder_at=COALESCE(saved_publications.agenda_reminder_at,excluded.agenda_reminder_at),
        agenda_reminder_notified=MAX(saved_publications.agenda_reminder_notified,excluded.agenda_reminder_notified),
        saved_at=MIN(saved_publications.saved_at,excluded.saved_at)`, values: [accountId, sourceUserId] },
    { sql: `INSERT OR IGNORE INTO notifications (user_id,publication_id,type,created_at,read,dedupe_key,scheduled_at,attempted_at,accepted_at,failure_reason)
      SELECT ?,publication_id,type,created_at,read,CASE WHEN dedupe_key='' THEN 'linked-source:' || id ELSE dedupe_key END,scheduled_at,attempted_at,accepted_at,failure_reason FROM notifications WHERE user_id=?`, values: [accountId, sourceUserId] },
    { sql: `INSERT OR IGNORE INTO training_reminders (id,user_id,training_id,publication_id,opens_at,precision,advance_minutes,remind_at,notified,created_at,updated_at)
      SELECT ? || training_id || ':' || COALESCE(advance_minutes,-1),?,training_id,publication_id,opens_at,precision,advance_minutes,remind_at,notified,created_at,updated_at FROM training_reminders WHERE user_id=?`, values: [accountId + ":", accountId, sourceUserId] },
    { sql: `INSERT INTO designation_tracking (id,user_id,publication_id,status,role,subject,school,address,locality,applied_at,appointment_at,shift,board,documentation,order_number,notes,official_url,reminder_at,reminder_notified,created_at,updated_at)
      SELECT ? || ':' || source.publication_id,?,source.publication_id,source.status,source.role,source.subject,source.school,source.address,source.locality,source.applied_at,source.appointment_at,source.shift,source.board,source.documentation,source.order_number,source.notes,source.official_url,source.reminder_at,source.reminder_notified,source.created_at,source.updated_at
      FROM designation_tracking source WHERE source.user_id=? AND NOT EXISTS (SELECT 1 FROM designation_tracking target WHERE target.user_id=? AND target.publication_id=source.publication_id)`, values: [accountId, accountId, sourceUserId, accountId] },
    { sql: `INSERT OR IGNORE INTO manual_events (id,user_id,title,notes,category,starts_at,all_day,recurrence,reminder_minutes,reminder_at,reminder_notified,created_at,updated_at)
      SELECT CASE WHEN substr(id,1,length(?) + 1)=? || ':' THEN ? || ':' || substr(id,length(?) + 2) ELSE ? || ':' || id END,?,title,notes,category,starts_at,all_day,recurrence,reminder_minutes,reminder_at,reminder_notified,created_at,updated_at FROM manual_events WHERE user_id=?`, values: [sourceUserId, sourceUserId, accountId, sourceUserId, accountId, accountId, sourceUserId] },
    { sql: `INSERT OR IGNORE INTO manual_event_push_queue (user_id,event_id,title,occurrence_at,created_at)
      SELECT ?,CASE WHEN substr(event_id,1,length(?) + 1)=? || ':' THEN ? || ':' || substr(event_id,length(?) + 2) ELSE ? || ':' || event_id END,title,occurrence_at,created_at FROM manual_event_push_queue WHERE user_id=?`, values: [accountId, sourceUserId, sourceUserId, accountId, sourceUserId, accountId, sourceUserId] },
    { sql: `INSERT OR IGNORE INTO push_preferences (user_id,enabled,vacancies,trainings,commissions,reminders,date_changes,closing_soon,boards,designation_exact,designation_partial,designation_roles,quiet_start,quiet_end,timezone,updated_at)
      SELECT ?,enabled,vacancies,trainings,commissions,reminders,date_changes,closing_soon,boards,designation_exact,designation_partial,designation_roles,quiet_start,quiet_end,timezone,updated_at FROM push_preferences WHERE user_id=?`, values: [accountId, sourceUserId] },
    { sql: "UPDATE push_subscriptions SET user_id=?,updated_at=CURRENT_TIMESTAMP WHERE user_id=?", values: [accountId, sourceUserId] },
  ];
  if (mergedProfile) {
    statements.splice(1, 0, {
      sql: `INSERT INTO profiles (user_id,${PROFILE_COLUMNS.join(",")}) VALUES (${["?", ...PROFILE_COLUMNS.map(() => "?")].join(",")}) ON CONFLICT(user_id) DO UPDATE SET ${PROFILE_COLUMNS.map((column) => `${column}=excluded.${column}`).join(",")}`,
      values: [accountId, ...PROFILE_COLUMNS.map((column) => mergedProfile[column] == null ? null : typeof mergedProfile[column] === "number" ? mergedProfile[column] as number : String(mergedProfile[column]))],
    });
  }
  return statements;
}

export async function linkInstallationData(database: IdentityDatabase, accountId: string, deviceId: string, consent: boolean) {
  if (!consent) throw new InstallationLinkError("CONSENT_REQUIRED");
  if (!validInstallationId(deviceId)) throw new InstallationLinkError("NO_INSTALLATION");
  const existing = await database.prepare("SELECT account_id FROM account_installations WHERE device_id=?").bind(deviceId).first<{ account_id: string }>();
  if (existing) {
    if (existing.account_id !== accountId) throw new InstallationLinkError("LINKED_TO_ANOTHER_ACCOUNT");
    return { linked: true, alreadyLinked: true };
  }
  const sourceUserId = deviceUser(deviceId)!.userId;
  const [accountProfile, deviceProfile] = await Promise.all([
    database.prepare("SELECT * FROM profiles WHERE user_id=?").bind(accountId).first<Record<string, unknown>>(),
    database.prepare("SELECT * FROM profiles WHERE user_id=?").bind(sourceUserId).first<Record<string, unknown>>(),
  ]);
  const mergedProfile = mergePrivateProfileRows(accountProfile, deviceProfile);
  await database.batch(buildInstallationLinkStatements(accountId, deviceId, mergedProfile).map((statement) => database.prepare(statement.sql).bind(...statement.values)));
  return { linked: true, alreadyLinked: false };
}
