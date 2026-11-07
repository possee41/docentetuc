import assert from "node:assert/strict";
import test from "node:test";
import { createFdciPersonalHarness } from "./fdci-personal-local-harness.mjs";
const ok = r => assert.equal(r.status, 200, JSON.stringify(r.body));

test("authenticated HTTP handlers persist external save, Agenda, reminder, cancellation and cleanup", async () => {
  const h = await createFdciPersonalHarness();
  try {
    ok(await h.action("save")); assert.equal(h.count("publications"), 1); assert.equal(h.count("saved_publications"), 1);
    const agendaAt = new Date(h.clock + 4 * 86400000).toISOString();
    ok(await h.action("agenda", { agendaAt, agendaNotes: "Nota privada A", agendaReminderAt: new Date(h.clock + 2 * 86400000).toISOString() }));
    ok(await h.action("set_training_reminder", { advanceMinutes: [60] })); assert.equal(h.count("training_reminders"), 1);
    const loaded = await h.request("GET"); ok(loaded); assert.equal(loaded.body.saved[0].in_agenda, 1);
    assert.equal(loaded.body.saved[0].agenda_at, agendaAt); assert.equal(loaded.body.reminders.length, 1); assert.equal(loaded.body.personalPublications.length, 1);
    ok(await h.post({ action: "remove_training_reminder", trainingId: h.course.id })); assert.equal(h.count("training_reminders"), 0);
    ok(await h.action("agenda", { enabled: false })); assert.equal((await h.request("GET")).body.saved[0].in_agenda, 0);
    ok(await h.action("save", { enabled: false })); assert.deepEqual((await h.request("GET")).body.saved, []);
    assert.equal(h.count("publications"), 1); assert.equal(h.count("notifications"), 0);
    assert.equal(JSON.parse(h.raw.prepare("SELECT metadata FROM publications").get().metadata).catalogOnly, true);
    assert.equal(h.requests.length, 2); // One reference + one immutable version for the whole warm flow.
  } finally { h.close(); }
});
test("test sessions are isolated; absent sessions and another user's cleanup cannot read/change owner data", async () => {
  const h = await createFdciPersonalHarness();
  try {
    assert.equal((await h.request("POST", { action: "save", publicationId: h.course.id }, null)).status, 401);
    ok(await h.action("save")); ok(await h.action("set_training_reminder", { advanceMinutes: [60] }));
    const before = h.raw.prepare("SELECT * FROM saved_publications").all();
    const other = await h.request("GET", null, "b"); ok(other); assert.deepEqual(other.body.saved, []); assert.deepEqual(other.body.personalPublications, []);
    assert.equal((await h.post({ action: "save", enabled: false, publicationId: h.course.id, userId: "test-a" }, "b")).status, 404);
    assert.equal((await h.post({ action: "agenda", enabled: false, publicationId: h.course.id, userId: "test-a" }, "b")).status, 404);
    ok(await h.post({ action: "remove_training_reminder", trainingId: h.course.id, userId: "test-a" }, "b"));
    assert.equal(h.count("training_reminders"), 1); assert.deepEqual(h.raw.prepare("SELECT * FROM saved_publications").all(), before);
  } finally { h.close(); }
});
test("repeated and concurrent requests, plus a lost HTTP ACK, do not duplicate persisted rows", async () => {
  const h = await createFdciPersonalHarness();
  try {
    (await Promise.all(Array.from({ length: 8 }, () => h.action("save")))).forEach(ok);
    assert.equal(h.count("publications"), 1); assert.equal(h.count("saved_publications"), 1); assert.equal(h.requests.length, 2);
    await h.action("set_training_reminder", { advanceMinutes: [60, 60] }); // Deliberately discard the ACK, then recover by GET.
    assert.equal((await h.request("GET")).body.reminders.length, 1);
    ok(await h.action("set_training_reminder", { advanceMinutes: [60] })); assert.equal(h.count("training_reminders"), 1);
  } finally { h.close(); }
});
test("batch failure rolls back materialization and relation; invalid agenda cannot leave partial writes", async () => {
  const h = await createFdciPersonalHarness();
  try {
    assert.equal((await h.action("agenda", { agendaAt: "invalid" })).status, 400); assert.equal(h.count("publications"), 0);
    h.failOnce = "INSERT INTO saved_publications";
    assert.equal((await h.action("save")).status, 500); assert.equal(h.count("publications"), 0); assert.equal(h.count("saved_publications"), 0);
    ok(await h.action("save")); assert.equal(h.count("publications"), 1);
  } finally { h.close(); }
});
test("generation changes, modified/withdrawn courses and administrative edits preserve existing personal data", async () => {
  const h = await createFdciPersonalHarness();
  try {
    ok(await h.action("save")); const original = h.raw.prepare("SELECT * FROM publications").get(); const old = h.reference;
    h.clock += 61_000; await h.setCatalog([{ ...h.course, title: "Fuente modificada" }], 2);
    assert.equal((await h.post({ action: "agenda", publicationId: h.course.id, fdciCatalog: old })).status, 409);
    assert.equal((await h.action("agenda")).status, 409); assert.deepEqual(h.raw.prepare("SELECT * FROM publications").get(), original);
    h.clock += 61_000; await h.setCatalog([], 3); assert.equal((await h.action("set_training_reminder", { advanceMinutes: [60] })).status, 409);
    assert.equal((await h.request("GET")).body.personalPublications.length, 1);
    h.env.FDCI_PERSONAL_ACTIONS_ENABLED = "false"; h.failFetch = true;
    ok(await h.action("save", { enabled: false })); assert.equal(h.count("saved_publications"), 0); assert.equal(h.count("publications"), 1);
  } finally { h.close(); }
});
test("concurrent administrative edit is not overwritten and cannot advance Agenda", async () => {
  const h = await createFdciPersonalHarness();
  try {
    ok(await h.action("save")); h.beforeBatch = () => h.raw.prepare("UPDATE publications SET title='Edición administrativa',content_hash='admin-change'").run();
    assert.equal((await h.action("agenda", { agendaAt: new Date(h.clock + 86400000).toISOString() })).status, 409);
    assert.equal(h.raw.prepare("SELECT title FROM publications").get().title, "Edición administrativa");
    assert.equal(h.raw.prepare("SELECT in_agenda FROM saved_publications").get().in_agenda, 0);
  } finally { h.close(); }
});
test("arbitrary IDs, unknown membership, wrong revision, disabled feature and production hostname fail closed", async () => {
  const h = await createFdciPersonalHarness();
  try {
    for (const publicationId of ["fdci:evil", "fdci:commission:980000001", "fdci:commission:9999", "arbitrary-id"])
      assert((await h.action("save", { publicationId })).status >= 400);
    assert.equal((await h.action("save", { fdciCatalog: { ...h.reference, generation: 99 } })).status, 409);
    assert.equal((await h.action("save", { fdciCatalog: null })).status, 409);
    assert.equal((await h.request("POST", { action: "save", publicationId: h.course.id, fdciCatalog: h.reference }, "a", "https://docentetuc.com.ar")).status, 503);
    h.env.FDCI_PERSONAL_ACTIONS_ENABLED = "false"; assert.equal((await h.action("save")).status, 503);
    assert.equal(h.count("publications"), 0); assert.equal(h.count("saved_publications"), 0);
  } finally { h.close(); }
});
test("older catalog without explicit timing evidence allows Save/Agenda but cannot invent an opening reminder", async () => {
  const h = await createFdciPersonalHarness();
  try {
    await h.setCatalog([h.course], 1, false); ok(await h.action("save")); ok(await h.action("agenda", { agendaAt: new Date(h.clock + 86400000).toISOString() }));
    assert.equal((await h.action("set_training_reminder", { advanceMinutes: [60] })).status, 400); assert.equal(h.count("training_reminders"), 0);
  } finally { h.close(); }
});

test("corrupt checksums, unavailable or stale catalog fail closed without materialization", async () => {
  for (const scenario of ["checksum", "network", "stale", "demo"]) {
    const h = await createFdciPersonalHarness();
    try {
      if (scenario === "checksum") h.catalog.items[0].title = "Contenido alterado";
      if (scenario === "network") h.failFetch = true;
      if (scenario === "stale") h.clock += 2 * 86400000;
      if (scenario === "demo") h.catalog.version = "14ffa0ebd934c43d36757b89be76318ee0053a45352912f758786ee5377c613b";
      assert.equal((await h.action("save")).status, 503, scenario);
      assert.equal(h.count("publications"), 0); assert.equal(h.count("saved_publications"), 0);
      assert(h.requests.every(r => !r.url.endsWith("/catalog.json")));
    } finally { h.close(); }
  }
});

test("evidence is checksummed and cannot claim precise time from a date-only value", async () => {
  const { buildFdciCatalog, validateFdciCatalog } = await import("../lib/fdci-static-catalog.ts");
  const h = await createFdciPersonalHarness();
  try {
    const evidence = h.catalog.reminderEvidence;
    await assert.rejects(buildFdciCatalog([{ ...h.course, registrationOpenAt: "2027-01-01" }], h.catalog.updatedAt, undefined, evidence));
    const corrupt = structuredClone(h.catalog); corrupt.reminderEvidence[h.course.id].trainingId = "999";
    await assert.rejects(validateFdciCatalog(corrupt));
    assert.equal((await validateFdciCatalog(h.catalog)).schemaVersion, 3);
  } finally { h.close(); }
});

test("failed reminder write preserves prior configuration and warm catalog refresh requires validation", async () => {
  const h = await createFdciPersonalHarness();
  try {
    ok(await h.action("set_training_reminder", { advanceMinutes: [60] }));
    const before = h.raw.prepare("SELECT * FROM training_reminders").all();
    h.failOnce = "INSERT INTO training_reminders";
    assert.equal((await h.action("set_training_reminder", { advanceMinutes: [1440] })).status, 500);
    assert.deepEqual(h.raw.prepare("SELECT * FROM training_reminders").all(), before);
    assert.equal(h.requests.length, 2);
    h.clock += 61000; h.failFetch = true;
    assert.equal((await h.action("agenda")).status, 503);
    assert.deepEqual(h.raw.prepare("SELECT * FROM training_reminders").all(), before);
    ok(await h.post({ action: "remove_training_reminder", trainingId: h.course.id }));
    assert.equal(h.count("training_reminders"), 0);
  } finally { h.close(); }
});


test("cross-origin mutation, empty official catalog and oversized cold snapshot cannot create private data", async () => {
  const h = await createFdciPersonalHarness();
  try {
    const denied = await h.handlers.POST(new Request("http://localhost:5186/api/app", { method: "POST", headers: { Authorization: "Bearer unit-session-a", Origin: "https://untrusted.invalid", "Content-Type": "application/json" }, body: JSON.stringify({ action: "save", publicationId: h.course.id, fdciCatalog: h.reference }) }));
    assert.equal(denied.status, 403); assert.equal(h.requests.length, 0);
    await h.setCatalog([], 1); assert.equal((await h.action("save")).status, 409);
    h.clock += 61000;
    const many = Array.from({ length: 80 }, (_, n) => ({ ...h.course, id: `fdci:commission:${501+n}`, externalId: String(501+n), summary: "x".repeat(2000) }));
    await h.setCatalog(many, 2); assert.equal((await h.action("save")).status, 503);
    assert.equal(h.count("publications"), 0); assert.equal(h.count("saved_publications"), 0);
  } finally { h.close(); }
});

test("existing D1 training keeps Save, Agenda and reminder behavior without the external flag or catalog network", async () => {
  const h = await createFdciPersonalHarness();
  try {
    ok(await h.action("save"));
    h.raw.exec("DELETE FROM saved_publications");
    h.raw.prepare("UPDATE publications SET id='local:official',source='Capacitación Docente',metadata=json_remove(metadata,'$.catalogOnly','$.catalogOrigin')").run();
    const at = new Date(h.clock).toISOString();
    h.raw.prepare("INSERT INTO sync_state(source,synced_at,item_count,sync_status,last_attempt_at,last_successful_sync_at) VALUES(?,?,1,'OK',?,?)").run("Capacitación Docente",at,at,at);
    h.env.FDCI_PERSONAL_ACTIONS_ENABLED = "false"; h.failFetch = true; const network = h.requests.length;
    ok(await h.action("save", { publicationId: "local:official" }));
    ok(await h.action("agenda", { publicationId: "local:official", agendaAt: new Date(h.clock + 86400000).toISOString() }));
    ok(await h.action("set_training_reminder", { publicationId: "local:official", advanceMinutes: [60] }));
    assert.equal(h.count("training_reminders"), 1); assert.equal(h.requests.length, network);
    assert.equal(h.raw.prepare("SELECT in_agenda FROM saved_publications").get().in_agenda, 1);
    ok(await h.post({ action: "remove_training_reminder", trainingId: h.course.id }));
    assert.equal(h.count("training_reminders"), 0);
  } finally { h.close(); }
});
