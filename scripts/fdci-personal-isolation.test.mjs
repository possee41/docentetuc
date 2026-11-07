import test from "node:test";
import assert from "node:assert/strict";
import { createFdciPersonalHarness } from "./fdci-personal-local-harness.mjs";
import { FDCI_PERSONAL_FIXTURE_ID as id } from "../lib/fdci-personal-fixture-id.ts";
import { PUBLICATION_VISIBILITY_SQL, isPublicPublication } from "../lib/publication-visibility.ts";
import { fdciPersonalBlocked } from "../lib/fdci-personal-contract.ts";
import { materializeExternalReminderBatch } from "./external-reminders.mjs";
const trace = "11111111-1111-4111-8111-111111111111";
async function setup() {
  const h = await createFdciPersonalHarness();
  Object.assign(h.env, { FDCI_CANARY_FIXTURE_ENABLED: "true", FDCI_CANARY_FIXTURE_RUN_ID: trace,
    FDCI_CANARY_FIXTURE_OPENS_AT: new Date(h.clock + 2*86400000).toISOString(), FDCI_CANARY_FIXTURE_EXPIRES_AT: new Date(h.clock + 1200000).toISOString() });
  h.call = async (method, body, user = "a", origin = "https://canary.docentetuc.com.ar", extra = {}) => {
    const r = await h.handlers[method](new Request(origin + "/api/app" + (method === "GET" ? "?fdciPersonalFixture=1" : ""), { method,
      headers: { Origin: origin, "Content-Type": "application/json", "X-DocenteTuc-FDCI-Trace": trace, ...(user ? { Authorization: `Bearer unit-session-${user}` } : {}), ...extra },
      ...(method === "POST" ? { body: JSON.stringify(body) } : {}) }));
    return { status:r.status, body:await r.json(), cache:r.headers.get("X-FDCI-Fixture-Cache"), cacheControl:r.headers.get("Cache-Control") };
  };
  h.fixtureAction = (action, extra={}, user="a") => h.call("POST",{ action, publicationId:id, fdciCatalog:h.fixtureRef, ...extra },user);
  h.preview = async () => { const r=await h.call("GET");assert.equal(r.status,200,JSON.stringify(r.body));h.fixtureRef={generation:1,catalogSha256:JSON.parse(r.body.fdciCanaryFixture.metadata).catalogSha256};return r; };
  return h;
}
const ok = r=>assert.equal(r.status,200,JSON.stringify(r.body));

test("only the real authenticated stable ID on the server allowlist may read or mutate the private Canary fixture",async()=>{
 const h=await setup();try{
  const baseline=h.sql.length;
  assert.equal((await h.call("GET",undefined,"b")).status,403);assert.equal(h.sql.length,baseline);
  const quiet = test.mock.method(console, "error", () => {});
  assert.equal((await h.call("GET",undefined,null)).status,401);assert.equal(h.sql.length,baseline);
  quiet.mock.restore();
  h.noAccount=true;assert.equal((await h.call("GET")).status,403);h.noAccount=false;
  for(const host of ["https://docentetuc.com.ar","https://docentetuc.workers.dev"])
   assert.equal((await h.call("GET",undefined,"a",host)).status,403);
  h.env.FDCI_CANARY_TEST_ENVIRONMENT="production";assert.equal((await h.call("GET")).status,403);
  h.env.FDCI_CANARY_TEST_ENVIRONMENT="docentetuc-web-canary-1-2";
  for(const setting of [undefined,"not-json",JSON.stringify(["test-b"]),JSON.stringify(["test-a","test-b"])]){
   h.env.FDCI_CANARY_TEST_USER_IDS=setting;assert.equal((await h.call("GET")).status,403);
  }
  h.env.FDCI_CANARY_TEST_USER_IDS=JSON.stringify(["test-a"]);
  const r=await h.preview();assert.equal(r.cache,"cold");assert.equal(r.cacheControl,"private, no-store");
  assert.equal((await h.preview()).cache,"warm");assert.match(r.body.fdciCanaryFixture.title,/FICTICIA/);
  assert.equal(h.requests.length,0);assert.equal(h.count("publications"),0);
 }finally{h.close();}
});

test("the isolated fixture uses real handlers and SQLite for Save, Agenda, reminder, cancellation and complete cleanup",async()=>{
 const h=await setup();try{
  await h.preview();ok(await h.fixtureAction("save"));
  ok(await h.fixtureAction("agenda",{agendaAt:new Date(h.clock+86400000).toISOString()}));
  ok(await h.fixtureAction("set_training_reminder",{advanceMinutes:[60]}));
  const reloaded=await h.preview();assert.equal(reloaded.body.saved[0].in_agenda,1);assert.equal(reloaded.body.reminders.length,1);
  const row=h.raw.prepare("SELECT * FROM publications WHERE id=?").get(id);assert.equal(row.official_url,"");
  assert.equal(isPublicPublication(row),false);
  assert.deepEqual(h.raw.prepare(`SELECT id FROM publications WHERE ${PUBLICATION_VISIBILITY_SQL}`).all(),[]);
  assert.equal(h.requests.length,0); // Neither official reference nor retired DEMO was fetched.
  for(const action of ["save","agenda","set_training_reminder","remove_training_reminder","cleanup_fdci_canary_fixture"]){
   const before=h.raw.prepare("SELECT total_changes() AS n").get().n;
   const result=await h.fixtureAction(action,{trainingId:id,userId:"test-a",advanceMinutes:[60]},"b");
   assert.equal(result.status,403);assert.equal(h.raw.prepare("SELECT total_changes() AS n").get().n,before);
  }
  assert.equal((await h.fixtureAction("remove_training_reminder",{trainingId:"  "+id+"  ",publicationId:"  "+id+"  "},"b")).status,403);
  const other=await h.request("GET",undefined,"b");assert.deepEqual(other.body.saved,[]);assert.deepEqual(other.body.personalPublications,[]);
  assert.equal(other.body.fdciCanaryFixture,null);
  ok(await h.fixtureAction("remove_training_reminder",{trainingId:id}));assert.equal(h.count("training_reminders"),0);
  ok(await h.fixtureAction("agenda",{enabled:false}));ok(await h.fixtureAction("save",{enabled:false}));
  // An unrelated, previously verified source row must survive fixture cleanup.
  ok(await h.action("save"));const official=h.raw.prepare("SELECT * FROM publications WHERE id=?").get(h.course.id);
  ok(await h.fixtureAction("cleanup_fdci_canary_fixture"));ok(await h.fixtureAction("cleanup_fdci_canary_fixture"));
  assert.equal(h.raw.prepare("SELECT * FROM publications WHERE id=?").get(id),undefined);
  assert.deepEqual(h.raw.prepare("SELECT * FROM publications WHERE id=?").get(h.course.id),official);
  assert.equal(h.count("saved_publications"),1);assert.equal(h.count("notifications"),0);
 }finally{h.close();}
});

test("fixture reminders cannot emit notices; expired and disabled tests deny new writes but permit owner-only cleanup",async()=>{
 const h=await setup();try{
  const initial=await h.preview();ok(await h.fixtureAction("save"));ok(await h.fixtureAction("set_training_reminder",{advanceMinutes:[60]}));
  assert.equal((await h.fixtureAction("agenda",{agendaReminderAt:new Date(h.clock-10000).toISOString()})).status,400);
  h.raw.prepare("UPDATE training_reminders SET remind_at='2000-01-01T00:00:00.000Z'").run();
  await h.preview();assert.equal(h.count("notifications"),0);assert.equal(h.raw.prepare("SELECT notified FROM training_reminders").get().notified,0);
  const ack=await materializeExternalReminderBatch(h.db,{limit:2});assert.equal(ack.considered,0);assert.equal(h.count("notifications"),0);
  h.clock+=1800001;h.env.FDCI_PERSONAL_ACTIONS_ENABLED="false";h.env.FDCI_CANARY_FIXTURE_ENABLED="false";
  assert.equal(fdciPersonalBlocked(initial.body.fdciCanaryFixture),true);
  const before=h.raw.prepare("SELECT total_changes() AS n").get().n;
  assert.equal((await h.fixtureAction("save")).status,403);assert.equal((await h.call("GET")).status,403);
  assert.equal(h.raw.prepare("SELECT total_changes() AS n").get().n,before);
  ok(await h.fixtureAction("cleanup_fdci_canary_fixture"));assert.equal(h.count("publications"),0);assert.equal(h.count("training_reminders"),0);
 }finally{h.close();}
});

test("cleanup refuses changed snapshots or foreign references and rolls back injected local SQL failures",async()=>{
 const h=await setup();try{
  await h.preview();ok(await h.fixtureAction("save"));ok(await h.fixtureAction("set_training_reminder",{advanceMinutes:[60]}));
  h.raw.prepare("INSERT INTO saved_publications(user_id,publication_id) VALUES('test-b',?)").run(id);
  assert.equal((await h.fixtureAction("cleanup_fdci_canary_fixture")).status,409);assert.equal(h.count("saved_publications"),2);
  h.raw.prepare("DELETE FROM saved_publications WHERE user_id='test-b'").run();
  h.failOnce="DELETE FROM training_reminders";
  assert.equal((await h.fixtureAction("cleanup_fdci_canary_fixture")).status,500);assert.equal(h.count("saved_publications"),1);assert.equal(h.count("training_reminders"),1);
  const hash=h.raw.prepare("SELECT content_hash FROM publications").get().content_hash;
  h.raw.prepare("UPDATE publications SET content_hash='admin-change'").run();
  assert.equal((await h.fixtureAction("cleanup_fdci_canary_fixture")).status,409);assert.equal(h.count("saved_publications"),1);
  h.raw.prepare("UPDATE publications SET content_hash=?").run(hash);
  const metadata=h.raw.prepare("SELECT metadata FROM publications").get().metadata;
  h.beforeBatch=()=>h.raw.prepare("UPDATE publications SET metadata=json_set(metadata,'$.adminEdit',1)").run();
  assert.equal((await h.fixtureAction("cleanup_fdci_canary_fixture")).status,409);assert.equal(h.count("saved_publications"),1);
  h.raw.prepare("UPDATE publications SET metadata=?").run(metadata);ok(await h.fixtureAction("cleanup_fdci_canary_fixture"));
 }finally{h.close();}
});
