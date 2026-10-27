// Generates synthetic SQL for the dedicated push canary. Never opens D1.
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";

const identityGuard = "SELECT CASE WHEN (SELECT marker FROM push_canary_identity LIMIT 1) = 'docentetuc-push-canary-1-2' THEN 1 ELSE json_extract('INVALID_CANARY_DATABASE','$') END;";

export function generatePushCanarySql({ count, density, now = new Date() }) {
  if (![0, 100, 500, 1000].includes(count) || !["dense", "sparse"].includes(density) ||
      !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new Error("PUSH_CANARY_SCENARIO_INVALID");
  const hour = Number(new Intl.DateTimeFormat("en", { timeZone: "America/Argentina/Buenos_Aires",
    hour: "2-digit", hourCycle: "h23" }).format(now));
  const atHour = (value) => `${String(value % 24).padStart(2, "0")}:00`;
  const quietStart = atHour(hour + 6), quietEnd = atHour(hour + 7);
  const sql = [
    identityGuard,
    "DELETE FROM push_deliveries;", "DELETE FROM push_preferences;", "DELETE FROM push_subscriptions;",
    "DELETE FROM notifications;", "DELETE FROM manual_event_push_queue;", "DELETE FROM publications;",
    "INSERT INTO publications(id,title) VALUES('p1','Curso sintético');",
  ];
  for (let offset = 0; offset < count; offset += 25) {
    const ids = Array.from({ length: Math.min(25, count - offset) }, (_, index) => offset + index + 1);
    sql.push(`INSERT INTO notifications(id,user_id,publication_id,type,scheduled_at,created_at) VALUES ${ids.map((id) =>
      `(${id},'u${id}','p1','CAPACITACION_NUEVA','2026-01-02T12:00:00Z','2026-01-02T11:00:00Z')`).join(",")};`);
    const subscribed = density === "dense" ? ids : ids.filter((id) => id > count - 2);
    if (subscribed.length) {
      sql.push(`INSERT INTO push_subscriptions(endpoint,user_id,p256dh,auth,active,created_at) VALUES ${subscribed.map((id) =>
        `('https://fcm.googleapis.com/canary-u${id}','u${id}','synthetic','synthetic',1,'2026-01-01T00:00:00Z')`).join(",")};`);
      sql.push(`INSERT INTO push_preferences(user_id,quiet_start,quiet_end,timezone) VALUES ${subscribed.map((id) =>
        `('u${id}','${quietStart}','${quietEnd}','America/Argentina/Buenos_Aires')`).join(",")};`);
    }
  }
  return sql.join("\n") + "\n";
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const options = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=")));
  const sql = process.argv.includes("--reset") ? `${identityGuard}\nDELETE FROM push_deliveries;\n`
    : generatePushCanarySql({ count: Number(options.count), density: options.density });
  if (options.output) writeFileSync(options.output, sql, "utf8");
  else process.stdout.write(sql);
}
