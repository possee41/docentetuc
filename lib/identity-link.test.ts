import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { InstallationLinkError, installationDataPreview, linkInstallationData, type IdentityDatabase } from "./identity-link.ts";

const ACCOUNT_A = "550e8400-e29b-41d4-a716-446655440000";
const ACCOUNT_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const DEVICE_A = "550e8400-e29b-41d4-a716-446655440001";
const DEVICE_B = "550e8400-e29b-41d4-a716-446655440002";
const LEGACY_A = `device:${DEVICE_A}`;
const LEGACY_B = `device:${DEVICE_B}`;

type Bound = { first<T>(): Promise<T | null>; run(): Promise<unknown> };
function testDatabase(): { raw: DatabaseSync; d1: IdentityDatabase } {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user" (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL);
    CREATE TABLE account_installations (device_id TEXT PRIMARY KEY, source_user_id TEXT UNIQUE NOT NULL, account_id TEXT NOT NULL REFERENCES "user"(id) ON DELETE CASCADE, linked_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY,name TEXT DEFAULT 'Docente',email TEXT,level TEXT DEFAULT '',area TEXT DEFAULT '',subjects TEXT DEFAULT '',junta TEXT DEFAULT '',roles TEXT DEFAULT '',department TEXT DEFAULT '',locality TEXT DEFAULT '',shifts TEXT DEFAULT '',wants_interim INTEGER DEFAULT 1,wants_substitute INTEGER DEFAULT 1,training_interests TEXT DEFAULT '',characters TEXT DEFAULT '',circuits TEXT DEFAULT '',personal_match_threshold INTEGER DEFAULT 85,notify_new_trainings INTEGER DEFAULT 0,training_notify_scope TEXT DEFAULT 'relevant',training_match_threshold INTEGER DEFAULT 80,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE public_profiles (user_id TEXT PRIMARY KEY,display_name TEXT NOT NULL,avatar_id TEXT DEFAULT 'avatar_01',bio TEXT DEFAULT '',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE publications (id TEXT PRIMARY KEY);
    CREATE TABLE saved_publications (user_id TEXT,publication_id TEXT,in_agenda INTEGER DEFAULT 0,followed INTEGER DEFAULT 0,agenda_at TEXT,agenda_notes TEXT DEFAULT '',agenda_reminder_at TEXT,agenda_reminder_notified INTEGER DEFAULT 0,saved_at TEXT DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,publication_id));
    CREATE TABLE notifications (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,publication_id TEXT,type TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,read INTEGER DEFAULT 0,dedupe_key TEXT DEFAULT '',scheduled_at TEXT,attempted_at TEXT,accepted_at TEXT,failure_reason TEXT);
    CREATE UNIQUE INDEX notification_dedupe ON notifications(user_id,dedupe_key) WHERE dedupe_key<>'';
    CREATE TABLE training_reminders (id TEXT PRIMARY KEY,user_id TEXT,training_id TEXT,publication_id TEXT,opens_at TEXT,precision TEXT,advance_minutes INTEGER,remind_at TEXT,notified INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE designation_tracking (id TEXT PRIMARY KEY,user_id TEXT,publication_id TEXT,status TEXT,role TEXT,subject TEXT,school TEXT,address TEXT,locality TEXT,applied_at TEXT,appointment_at TEXT,shift TEXT,board TEXT,documentation TEXT,order_number TEXT,notes TEXT,official_url TEXT,reminder_at TEXT,reminder_notified INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE manual_events (id TEXT PRIMARY KEY,user_id TEXT,title TEXT,notes TEXT DEFAULT '',category TEXT DEFAULT 'Personal',starts_at TEXT,all_day INTEGER DEFAULT 0,recurrence TEXT DEFAULT 'none',reminder_minutes INTEGER,reminder_at TEXT,reminder_notified INTEGER DEFAULT 0,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE manual_event_push_queue (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id TEXT,event_id TEXT,title TEXT,occurrence_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,UNIQUE(event_id,occurrence_at));
    CREATE TABLE push_preferences (user_id TEXT PRIMARY KEY,enabled INTEGER DEFAULT 1,vacancies INTEGER DEFAULT 1,trainings INTEGER DEFAULT 1,commissions INTEGER DEFAULT 1,reminders INTEGER DEFAULT 1,date_changes INTEGER DEFAULT 1,closing_soon INTEGER DEFAULT 1,boards INTEGER DEFAULT 0,designation_exact INTEGER DEFAULT 1,designation_partial INTEGER DEFAULT 1,designation_roles INTEGER DEFAULT 1,quiet_start TEXT DEFAULT '22:00',quiet_end TEXT DEFAULT '07:00',timezone TEXT DEFAULT 'America/Argentina/Buenos_Aires',updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY,user_id TEXT,device_id TEXT,p256dh TEXT,auth TEXT,expiration_time INTEGER,user_agent TEXT DEFAULT '',active INTEGER DEFAULT 1,updated_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE push_deliveries (endpoint TEXT,event_key TEXT,PRIMARY KEY(endpoint,event_key));
    CREATE TABLE ai_rate_limits (user_bucket TEXT PRIMARY KEY);
    CREATE TABLE push_rate_limits (user_bucket TEXT PRIMARY KEY);
    CREATE TABLE "account" (id TEXT PRIMARY KEY,userId TEXT);
    CREATE TABLE "session" (id TEXT PRIMARY KEY,userId TEXT);
    CREATE TABLE verification (identifier TEXT);
  `);
  const d1 = {
    prepare(sql: string) {
      return {
        bind(...values: (string | number | null)[]) {
          const statement = raw.prepare(sql);
          const bound: Bound = {
            first: async <T>() => (statement.get(...values) as T | undefined) ?? null,
            run: async () => statement.run(...values),
          };
          return bound;
        },
      };
    },
    async batch(statements: unknown[]) {
      raw.exec("BEGIN IMMEDIATE");
      try {
        for (const statement of statements as Bound[]) await statement.run();
        raw.exec("COMMIT");
      } catch (error) { raw.exec("ROLLBACK"); throw error; }
    },
  } as IdentityDatabase;
  return { raw, d1 };
}

function seedUsers(raw: DatabaseSync) {
  raw.prepare('INSERT INTO "user" (id,email) VALUES (?,?)').run(ACCOUNT_A, "a@example.invalid");
  raw.prepare('INSERT INTO "user" (id,email) VALUES (?,?)').run(ACCOUNT_B, "b@example.invalid");
  raw.prepare("INSERT INTO publications (id) VALUES ('p1')").run();
}

test("preview de vinculación detecta datos personalizados, no el perfil default que crea /api/app", async () => {
  const { raw, d1 } = testDatabase();
  try {
    seedUsers(raw);
    raw.prepare("INSERT INTO profiles (user_id) VALUES (?)").run(LEGACY_A);
    assert.deepEqual(await installationDataPreview(d1, ACCOUNT_A, DEVICE_A), { linked: false, hasData: false, dataCategories: [] });
    raw.prepare("UPDATE profiles SET level='Secundario' WHERE user_id=?").run(LEGACY_A);
    const preview = await installationDataPreview(d1, ACCOUNT_A, DEVICE_A);
    assert.equal(preview.hasData, true);
    assert.deepEqual(preview.dataCategories, ["profile"]);
  } finally { raw.close(); }
});

test("sin consentimiento no hay mapeo ni cambio de filas", async () => {
  const { raw, d1 } = testDatabase();
  try {
    seedUsers(raw);
    raw.prepare("INSERT INTO profiles (user_id,level) VALUES (?, 'Inicial')").run(LEGACY_A);
    await assert.rejects(linkInstallationData(d1, ACCOUNT_A, DEVICE_A, false), (error: unknown) => error instanceof InstallationLinkError && error.code === "CONSENT_REQUIRED");
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM account_installations").get() as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT level FROM profiles WHERE user_id=?").get(LEGACY_A) as { level: string }).level, "Inicial");
  } finally { raw.close(); }
});

test("combina selecciones de perfil sin duplicar opciones cuando ya existe perfil de cuenta", async () => {
  const { raw, d1 } = testDatabase();
  try {
    seedUsers(raw);
    raw.prepare("INSERT INTO profiles (user_id,name,level,subjects) VALUES (?, 'Cuenta docente','Primario, Secundario','Historia')").run(ACCOUNT_A);
    raw.prepare("INSERT INTO profiles (user_id,name,level,subjects) VALUES (?, 'Nombre local','Secundario, Inicial','Historia, Matemática')").run(LEGACY_A);
    await linkInstallationData(d1, ACCOUNT_A, DEVICE_A, true);
    assert.deepEqual({ ...(raw.prepare("SELECT name,level,subjects FROM profiles WHERE user_id=?").get(ACCOUNT_A) as object) }, {
      name: "Cuenta docente", level: "Primario, Secundario, Inicial", subjects: "Historia, Matemática",
    });
    assert.equal((raw.prepare("SELECT name FROM profiles WHERE user_id=?").get(LEGACY_A) as { name: string }).name, "Nombre local");
  } finally { raw.close(); }
});

test("vincula al user.id, conserva avatar/bio, une duplicados sin duplicarlos y es idempotente", async () => {
  const { raw, d1 } = testDatabase();
  try {
    seedUsers(raw);
    raw.prepare("INSERT INTO profiles (user_id,level) VALUES (?, 'Secundario')").run(LEGACY_A);
    raw.prepare("INSERT INTO public_profiles (user_id,display_name,avatar_id,bio) VALUES (?, 'Docente pública','avatar_24','Bio')").run(LEGACY_A);
    raw.prepare("INSERT INTO saved_publications (user_id,publication_id,in_agenda,followed,agenda_notes) VALUES (?, 'p1',0,0,'nota de cuenta')").run(ACCOUNT_A);
    raw.prepare("INSERT INTO saved_publications (user_id,publication_id,in_agenda,followed,agenda_notes) VALUES (?, 'p1',1,1,'nota del dispositivo')").run(LEGACY_A);
    raw.prepare("INSERT INTO notifications (user_id,publication_id,type,dedupe_key) VALUES (?, 'p1','NUEVA','event:p1')").run(ACCOUNT_A);
    raw.prepare("INSERT INTO notifications (user_id,publication_id,type,dedupe_key) VALUES (?, 'p1','NUEVA','event:p1')").run(LEGACY_A);
    raw.prepare("INSERT INTO manual_events (id,user_id,title,starts_at) VALUES ('event-device',?,'Turno','2026-10-05')").run(LEGACY_A);
    raw.prepare("INSERT INTO training_reminders (id,user_id,training_id,publication_id,opens_at,precision,advance_minutes,remind_at) VALUES ('legacy-reminder',?,'training-1','p1','2026-10-06','date',60,'2026-10-06')").run(LEGACY_A);
    raw.prepare("INSERT INTO push_preferences (user_id,enabled,boards) VALUES (?,0,1)").run(LEGACY_A);
    raw.prepare("INSERT INTO push_subscriptions (endpoint,user_id,device_id,p256dh,auth) VALUES ('push-endpoint',?,'device-a','p256','auth')").run(LEGACY_A);

    assert.deepEqual(await linkInstallationData(d1, ACCOUNT_A, DEVICE_A, true), { linked: true, alreadyLinked: false });
    assert.deepEqual(await linkInstallationData(d1, ACCOUNT_A, DEVICE_A, true), { linked: true, alreadyLinked: true });
    assert.equal((raw.prepare("SELECT account_id FROM account_installations WHERE device_id=?").get(DEVICE_A) as { account_id: string }).account_id, ACCOUNT_A);
    assert.equal((raw.prepare("SELECT level FROM profiles WHERE user_id=?").get(ACCOUNT_A) as { level: string }).level, "Secundario");
    assert.deepEqual({ ...(raw.prepare("SELECT display_name,avatar_id,bio FROM public_profiles WHERE user_id=?").get(ACCOUNT_A) as object) }, { display_name: "Docente pública", avatar_id: "avatar_24", bio: "Bio" });
    assert.deepEqual({ ...(raw.prepare("SELECT in_agenda,followed,agenda_notes FROM saved_publications WHERE user_id=? AND publication_id='p1'").get(ACCOUNT_A) as object) }, { in_agenda: 1, followed: 1, agenda_notes: "nota de cuenta\nnota del dispositivo" });
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM notifications WHERE user_id=? AND dedupe_key='event:p1'").get(ACCOUNT_A) as { n: number }).n, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM manual_events WHERE user_id=?").get(ACCOUNT_A) as { n: number }).n, 1, JSON.stringify(raw.prepare("SELECT id,user_id FROM manual_events").all()));
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM training_reminders WHERE user_id=?").get(ACCOUNT_A) as { n: number }).n, 1);
    assert.equal((raw.prepare("SELECT enabled FROM push_preferences WHERE user_id=?").get(ACCOUNT_A) as { enabled: number }).enabled, 0);
    assert.equal((raw.prepare("SELECT user_id FROM push_subscriptions WHERE endpoint='push-endpoint'").get() as { user_id: string }).user_id, ACCOUNT_A);
    // Legacy rows remain intact as the linked installation's safety copy, but are no longer the active owner key.
    assert.equal((raw.prepare("SELECT level FROM profiles WHERE user_id=?").get(LEGACY_A) as { level: string }).level, "Secundario");
  } finally { raw.close(); }
});

test("una cuenta A no puede previsualizar ni vincular la instalación ya vinculada por B", async () => {
  const { raw, d1 } = testDatabase();
  try {
    seedUsers(raw);
    raw.prepare("INSERT INTO account_installations (device_id,source_user_id,account_id) VALUES (?,?,?)").run(DEVICE_B, LEGACY_B, ACCOUNT_B);
    raw.prepare("INSERT INTO profiles (user_id,level) VALUES (?, 'Inicial')").run(LEGACY_B);
    await assert.rejects(installationDataPreview(d1, ACCOUNT_A, DEVICE_B), (error: unknown) => error instanceof InstallationLinkError && error.code === "LINKED_TO_ANOTHER_ACCOUNT");
    await assert.rejects(linkInstallationData(d1, ACCOUNT_A, DEVICE_B, true), (error: unknown) => error instanceof InstallationLinkError && error.code === "LINKED_TO_ANOTHER_ACCOUNT");
    assert.equal((raw.prepare("SELECT account_id FROM account_installations WHERE device_id=?").get(DEVICE_B) as { account_id: string }).account_id, ACCOUNT_B);
    assert.equal((raw.prepare("SELECT COUNT(*) n FROM profiles WHERE user_id=?").get(ACCOUNT_A) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT level FROM profiles WHERE user_id=?").get(LEGACY_B) as { level: string }).level, "Inicial");
  } finally { raw.close(); }
});
