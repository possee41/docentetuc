// Runs only in Node. Publication events, reminders and date alerts are
// idempotent; the Worker is responsible only for bounded push delivery.
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { scheduledNotificationTypes } from "../lib/push.ts";
import { parseTrainingMetadata } from "../lib/training.ts";
import { createD1Rest } from "./d1-rest.mjs";
import { resolveDirectD1Target, verifyDirectD1Identity } from "./import-direct-d1.mjs";
import { materializeNextPersistedNoticePage } from "./external-notifications.mjs";
import { materializeExternalReminderBatch } from "./external-reminders.mjs";

const trainingColumns = `id,kind,title,summary,level,area,junta,location,shift,character,circuit,
  source_circuit_raw,starts_at,ends_at,status,metadata,normalized_status`;

export async function loadScheduledTrainings(db, now = new Date()) {
  let cursor = "";
  const candidates = [];
  while (true) {
    const page = await db.prepare(`SELECT ${trainingColumns} FROM publications
      WHERE kind='capacitacion' AND normalized_status IN ('ACTIVE','UPCOMING')
        AND removed_at IS NULL AND id>? ORDER BY id LIMIT 100`).bind(cursor).all();
    for (const row of page.results || []) {
      const metadata = parseTrainingMetadata(row.metadata);
      if (!metadata?.registrationOpensAt || !["confirmed", "course_confirmed"].includes(metadata.dateStatus) ||
          (metadata.entity === "commission" && metadata.availablePreCapacity === 0)) continue;
      const opens = new Date(metadata.registrationOpensAt).getTime();
      const closes = new Date(metadata.registrationClosesAt || row.ends_at || 8.64e15).getTime();
      if (Number.isFinite(opens) && opens <= now.getTime() + 7 * 86_400_000 && closes > now.getTime())
        candidates.push(row);
    }
    if ((page.results || []).length < 100) return candidates;
    cursor = page.results.at(-1).id;
  }
}

/** @param {any} db @param {{now?: Date, trainings?: any[], limit?: number}} options */
export async function materializeScheduledNoticePage(db, { now = new Date(), trainings, limit = 25 } = {}) {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !Number.isInteger(limit) || limit < 1 || limit > 25)
    throw new Error("EXTERNAL_SCHEDULED_INVALID");
  const instant = now.toISOString(), hour = instant.slice(0, 13);
  const state = await db.prepare("SELECT cycle_at,status FROM external_notice_cycle WHERE id=1").bind().first();
  if (!state) throw new Error("EXTERNAL_NOTICE_MIGRATION_REQUIRED");
  if (state.status === "done" && state.cycle_at.slice(0, 13) === hour)
    return { complete: true, profiles: 0, considered: 0, inserted: 0 };
  const owner = randomUUID();
  const claimed = await db.prepare(`UPDATE external_notice_cycle SET
    profile_cursor=CASE WHEN status='done' THEN '' ELSE profile_cursor END,
    cycle_at=CASE WHEN status='done' THEN ? ELSE cycle_at END,
    status='pending',lease_owner=?,lease_until=?
    WHERE id=1 AND (lease_until IS NULL OR lease_until<=?)
      AND (status='pending' OR substr(cycle_at,1,13)<>?)`)
    .bind(instant, owner, new Date(now.getTime() + 600_000).toISOString(), instant, hour).run();
  if (!Number(claimed.meta?.changes ?? claimed.meta?.rows_written))
    return { busy: true, complete: false, profiles: 0, considered: 0, inserted: 0 };
  const owned = await db.prepare("SELECT profile_cursor FROM external_notice_cycle WHERE id=1 AND lease_owner=?").bind(owner).first();
  if (!owned) throw new Error("EXTERNAL_NOTICE_LEASE_LOST");
  const selected = trainings ?? await loadScheduledTrainings(db, now);
  const page = selected.length ? await db.prepare(`SELECT * FROM profiles
    WHERE notify_new_trainings=1 AND user_id>? ORDER BY user_id LIMIT ?`).bind(owned.profile_cursor, limit).all() : { results: [] };
  const profiles = page.results || [];
  const saved = new Set();
  if (profiles.length) {
    const savedRows = await db.prepare(`SELECT user_id,publication_id FROM saved_publications
      WHERE user_id IN (${profiles.map(() => "?").join(",")})`).bind(...profiles.map((profile) => profile.user_id)).all();
    for (const row of savedRows.results || []) saved.add(`${row.user_id}\0${row.publication_id}`);
  }
  const pending = [];
  for (const profile of profiles) for (const publication of selected) {
    const metadata = parseTrainingMetadata(publication.metadata);
    const eventDate = metadata?.registrationOpensAt || metadata?.registrationClosesAt || publication.ends_at || "unknown-date";
    for (const type of scheduledNotificationTypes(publication, profile,
      saved.has(`${profile.user_id}\0${publication.id}`), now)) {
      pending.push([profile.user_id, publication.id, type,
        `automatic:${publication.id}:${type}:${eventDate}`.slice(0, 255), instant]);
    }
  }
  let inserted = 0;
  for (let offset = 0; offset < pending.length; offset += 20) {
    const batch = pending.slice(offset, offset + 20);
    const result = await db.prepare(`INSERT OR IGNORE INTO notifications
      (user_id,publication_id,type,dedupe_key,scheduled_at) VALUES ${batch.map(() => "(?,?,?,?,?)").join(",")}`)
      .bind(...batch.flat()).run();
    if (!Number.isInteger(result.meta?.changes)) throw new Error("EXTERNAL_NOTICE_WRITE_UNCONFIRMED");
    inserted += result.meta.changes;
  }
  const complete = profiles.length < limit;
  const advanced = await db.prepare(`UPDATE external_notice_cycle SET profile_cursor=?,status=?,
    lease_owner=NULL,lease_until=NULL,completed_at=CASE WHEN ? THEN ? ELSE completed_at END
    WHERE id=1 AND lease_owner=? AND profile_cursor=? AND status='pending'`)
    .bind(profiles.at(-1)?.user_id || owned.profile_cursor, complete ? "done" : "pending",
      complete ? 1 : 0, instant, owner, owned.profile_cursor).run();
  if (!Number(advanced.meta?.changes ?? advanced.meta?.rows_written)) throw new Error("EXTERNAL_NOTICE_LEASE_LOST");
  return { complete, profiles: profiles.length, considered: pending.length, inserted };
}

/** @param {any} db @param {{now?: Date, maxSteps?: number}} options */
export async function runExternalMaterialization(db, { now, maxSteps = 100 } = {}) {
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > 100) throw new Error("EXTERNAL_STEPS_INVALID");
  const instant = () => now ?? new Date();
  const totals = { eventSteps: 0, eventNotices: 0, eventsDrained: false,
    reminderSteps: 0, reminders: 0, remindersDrained: false,
    scheduledSteps: 0, scheduledNotices: 0, scheduledComplete: false };
  for (let step = 0; step < maxSteps; step++) {
    const result = await materializeNextPersistedNoticePage(db, { now: instant() });
    if (!result.eventId) break;
    totals.eventSteps++;
    totals.eventNotices += result.inserted;
  }
  totals.eventsDrained = !(await db.prepare("SELECT id FROM external_publication_events WHERE status='pending' LIMIT 1").bind().first());
  for (let step = 0; step < maxSteps; step++) {
    const result = await materializeExternalReminderBatch(db, { now: instant() });
    if (!result.considered) { totals.remindersDrained = true; break; }
    totals.reminderSteps++;
    totals.reminders += result.inserted;
  }
  const trainings = await loadScheduledTrainings(db, instant());
  for (let step = 0; step < maxSteps; step++) {
    const result = await materializeScheduledNoticePage(db, { now: instant(), trainings });
    if (result.busy) break;
    totals.scheduledSteps++;
    totals.scheduledNotices += result.inserted;
    if (result.complete) { totals.scheduledComplete = true; break; }
  }
  return totals;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.env.DIRECT_D1_WRITE_ENABLED !== "true") throw new Error("DIRECT_D1_WRITE_DISABLED");
    const accountId = process.env.CF_ACCOUNT_ID, token = process.env.D1_IMPORT_TOKEN;
    const revision = process.env.DIRECT_D1_TARGET === "production"
      ? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim() : "";
    const target = resolveDirectD1Target(process.env, revision);
    const db = createD1Rest({ accountId, databaseId: target.id, token });
    await verifyDirectD1Identity({ accountId, token, target });
    const result = await runExternalMaterialization(db);
    console.log(JSON.stringify({ ...result, d1: db.metrics() }));
    if (!result.eventsDrained || !result.remindersDrained || !result.scheduledComplete)
      throw new Error("EXTERNAL_MATERIALIZATION_PARTIAL");
  } catch (error) {
    console.error("EXTERNAL_MATERIALIZATION_FAILED", error instanceof Error ? error.message : "unknown");
    process.exitCode = 1;
  }
}
