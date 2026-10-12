import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { acceptCommunityRules, createCommunityComment, createCommunityPost, editCommunityPost,
  listCommunityComments, listCommunityPosts, listCommunitySavedPostsPage, moderateCommunityContent,
  type CommunityDatabase } from "./community.ts";
import { listPreModerationHistory, listPreModerationQueue, reviewPreModeration, restrictCommunityAuthor } from "./community-pre-moderation-admin.ts";
import { geminiDraftClassifier, localDraftClassifier, normalizePreModerationResult,
  type CommunityDraftClassifier, type PreModerationResult } from "./community-pre-moderation.ts";
import { accountDataDeletionStatements } from "./account-deletion.ts";

const ADMIN = "550e8400-e29b-41d4-a716-446655440000";
const USER = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const migrations = ["0015_community.sql", "0016_community_saved_posts.sql", "0018_community_admin.sql", "0020_community_pre_moderation.sql"];
const classifier = (decision: PreModerationResult["decision"], categories: string[] = []): CommunityDraftClassifier =>
  async () => ({ decision, categories, confidence: decision === "rejected" ? 0.99 : 0.9,
    reason: "Prueba sintética", reviewRequired: decision === "pending_review" });

function fixture() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user"(id TEXT PRIMARY KEY, email TEXT);
    CREATE TABLE public_profiles(user_id TEXT PRIMARY KEY, display_name TEXT, avatar_id TEXT, bio TEXT);
    CREATE TABLE profiles(user_id TEXT PRIMARY KEY);
    CREATE TABLE "account"(id TEXT PRIMARY KEY, userId TEXT);
    CREATE TABLE "session"(id TEXT PRIMARY KEY, userId TEXT);
    CREATE TABLE verification(identifier TEXT);
    CREATE TABLE account_installations(device_id TEXT, source_user_id TEXT, account_id TEXT);
    CREATE TABLE push_subscriptions(endpoint TEXT,user_id TEXT);
    CREATE TABLE push_deliveries(endpoint TEXT);
    CREATE TABLE manual_event_push_queue(user_id TEXT);
    CREATE TABLE push_preferences(user_id TEXT);
    CREATE TABLE notifications(user_id TEXT);
    CREATE TABLE training_reminders(user_id TEXT);
    CREATE TABLE designation_tracking(user_id TEXT);
    CREATE TABLE saved_publications(user_id TEXT);
    CREATE TABLE manual_events(user_id TEXT);
    CREATE TABLE ai_rate_limits(user_bucket TEXT);
    CREATE TABLE push_rate_limits(user_bucket TEXT);`);
  for (const name of migrations) raw.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  for (const [id, name] of [[ADMIN, "Admin público"], [USER, "Docente público"]]) {
    raw.prepare('INSERT INTO "user" VALUES(?,?)').run(id, `${name}@example.invalid`);
    raw.prepare("INSERT INTO public_profiles VALUES(?,?,'avatar_01','')").run(id, name);
  }
  raw.prepare("INSERT INTO community_moderators(user_id,role) VALUES(?,'admin')").run(ADMIN);
  const db = {
    prepare(sql: string) { return { bind(...values: unknown[]) {
      const args = values as (null | number | bigint | string | Uint8Array)[];
      const runSync = () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } });
      return { runSync, run: async () => runSync(), first: async <T>() => raw.prepare(sql).get(...args) as T | null,
        all: async <T>() => ({ results: raw.prepare(sql).all(...args) as T[] }) };
    } }; },
    async batch(statements: unknown[]) { raw.exec("BEGIN"); try { const result = statements.map((item) => (item as { runSync(): unknown }).runSync()); raw.exec("COMMIT"); return result; }
      catch (error) { raw.exec("ROLLBACK"); throw error; } },
  } as CommunityDatabase;
  return { raw, db };
}

test("publicaciones normales, comentarios y críticas legítimas quedan aprobados", async () => {
  const { raw, db } = fixture();
  try {
    await acceptCommunityRules(db, USER, true);
    const post = await createCommunityPost(db, USER, "No estoy de acuerdo con la Junta y el sindicato", Date.now(), classifier("approved"));
    const comment = await createCommunityComment(db, USER, post.id, "Este reclamo laboral merece debate", Date.now(), classifier("approved"));
    assert.equal(post.moderationStatus, "approved"); assert.equal(comment.moderationStatus, "approved");
    assert.equal((await listCommunityPosts(db, null)).length, 1);
    assert.equal((await listCommunityComments(db, post.id, null)).length, 1);
    assert.equal((await localDraftClassifier("El salario docente es malo y las autoridades deben dar explicaciones")).decision, "approved");
    assert.equal((await localDraftClassifier("Me parece pésima la política educativa del sindicato")).decision, "approved");
  } finally { raw.close(); }
});

test("0020 se repite sin alterar publicaciones anteriores ni sus guardados", async () => {
  const { raw, db } = fixture();
  try {
    await acceptCommunityRules(db, USER, true);
    const post = await createCommunityPost(db, USER, "Contenido previo", Date.now(), classifier("approved"));
    raw.prepare("INSERT INTO community_saved_posts(user_id,post_id) VALUES(?,?)").run(USER, post.id);
    raw.exec(readFileSync(new URL("../migrations/0020_community_pre_moderation.sql", import.meta.url), "utf8"));
    assert.equal((await listCommunityPosts(db, USER)).length, 1);
    assert.equal((await listCommunitySavedPostsPage(db, USER)).posts.length, 1);
    assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM community_pre_moderation").get() as { n: number }).n, 1);
  } finally { raw.close(); }
});

test("repetición idéntica y enlaces abreviados se envían a revisión sin bloquear reclamos", async () => {
  const { raw, db } = fixture();
  try {
    await acceptCommunityRules(db, USER, true);
    const first = await createCommunityPost(db, USER, "Reclamo sobre condiciones docentes", Date.now(), classifier("approved"));
    const duplicate = await createCommunityPost(db, USER, "Reclamo sobre condiciones docentes", Date.now(), classifier("approved"));
    assert.equal(first.moderationStatus, "approved");
    assert.equal(duplicate.moderationStatus, "pending_review");
    assert.equal((await listCommunityPosts(db, null)).length, 1);
    assert.equal((await localDraftClassifier("Mirá https://bit.ly/ejemplo")).decision, "pending_review");
    assert.equal((await localDraftClassifier("Contraseña bancaria: ejemplo")).decision, "pending_review");
    assert.equal((await localDraftClassifier("Te voy a matar")).decision, "pending_review");
  } finally { raw.close(); }
});

test("categorías graves solo pueden ser rechazo automático con confianza muy alta", () => {
  for (const category of ["threat", "harassment", "discrimination", "severe_insult", "explicit_sexual", "violence", "fraud", "spam", "suspicious_link", "personal_data", "illegal"]) {
    assert.equal(normalizePreModerationResult({ decision: "rejected", categories: [category], confidence: 0.9 }).decision, "pending_review");
    assert.equal(normalizePreModerationResult({ decision: "rejected", categories: [category], confidence: 0.99 }).decision, "rejected");
  }
});

test("pendiente y rechazado nunca llegan al feed, comentarios públicos ni Guardadas; restaurar no los elude", async () => {
  const { raw, db } = fixture();
  try {
    await acceptCommunityRules(db, USER, true);
    const visible = await createCommunityPost(db, USER, "Consulta normal", Date.now(), classifier("approved"));
    const pending = await createCommunityPost(db, USER, "Texto ambiguo", Date.now(), classifier("pending_review", ["uncertain"]));
    const rejected = await createCommunityPost(db, USER, "Texto claramente indebido", Date.now(), classifier("rejected", ["threat"]));
    const pendingComment = await createCommunityComment(db, USER, visible.id, "Comentario ambiguo", Date.now(), classifier("pending_review", ["uncertain"]));
    assert.deepEqual((await listCommunityPosts(db, null)).map((item) => item.id), [visible.id]);
    assert.equal((await listCommunityComments(db, visible.id, null)).length, 0);
    assert.equal((await listCommunitySavedPostsPage(db, USER)).posts.length, 0);
    await assert.rejects(listCommunityComments(db, pending.id, null), { code: "NOT_FOUND" });
    await assert.rejects(moderateCommunityContent(db, ADMIN, { targetType: "post", targetId: rejected.id, action: "restore", reason: "other" }), { code: "INVALID_TARGET" });
    assert.equal((await listPreModerationQueue(db)).length, 2);
    assert.equal(pendingComment.moderationStatus, "pending_review");
  } finally { raw.close(); }
});

test("solo admin revisa, aprueba/rechaza, restringe y queda auditoría mínima", async () => {
  const { raw, db } = fixture();
  try {
    await acceptCommunityRules(db, USER, true);
    const post = await createCommunityPost(db, USER, "Caso pendiente", Date.now(), classifier("pending_review", ["uncertain"]));
    await assert.rejects(reviewPreModeration(db, USER, { targetType: "post", targetId: post.id, action: "approve" }), { status: 403 });
    await assert.rejects(reviewPreModeration(db, "", { targetType: "post", targetId: post.id, action: "approve" }), { status: 401 });
    await reviewPreModeration(db, ADMIN, { targetType: "post", targetId: post.id, action: "approve" });
    assert.equal((await listCommunityPosts(db, null)).length, 1);
    assert.ok((await listPreModerationHistory(db)).some((item) => item.action === "manual_approved"));
    await restrictCommunityAuthor(db, ADMIN, { targetType: "post", targetId: post.id });
    await assert.rejects(createCommunityPost(db, USER, "Otra consulta"), { code: "PARTICIPATION_RESTRICTED" });
    const history = JSON.stringify(await listPreModerationHistory(db));
    assert.doesNotMatch(history, /example\.invalid|avatar_01|Caso pendiente/u);
  } finally { raw.close(); }
});

test("ediciones se moderan otra vez y una eliminación de cuenta no retiene identidad ni texto", async () => {
  const { raw, db } = fixture();
  try {
    await acceptCommunityRules(db, USER, true);
    const post = await createCommunityPost(db, USER, "Consulta correcta", Date.now(), classifier("approved"));
    const edited = await editCommunityPost(db, USER, post.id, "Cambio ambiguo", Date.now(), classifier("pending_review", ["uncertain"]));
    assert.equal(edited.moderationStatus, "pending_review");
    assert.equal((await listCommunityPosts(db, null)).length, 0);
    await reviewPreModeration(db, ADMIN, { targetType: "post", targetId: post.id, action: "reject" });
    assert.equal((await listCommunityPosts(db, null)).length, 0);
    for (const { sql, values } of accountDataDeletionStatements(USER)) raw.prepare(sql).run(...values as (null | number | string)[]);
    assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM community_pre_moderation").get() as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT COUNT(*) AS n FROM community_pre_moderation_events").get() as { n: number }).n, 0);
  } finally { raw.close(); }
});

test("Gemini recibe solo texto/tipo, 429 y timeout pasan a revisión; rechazo exige confianza alta", async () => {
  const calls: { url: string; body: string }[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    calls.push({ url: String(input), body: String(init?.body) });
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ decision: "approved", categories: [], confidence: 0.9, reason: "Seguro" }) }] } }] });
  };
  const classify = geminiDraftClassifier({ provider: "gemini", apiKey: "SYNTHETIC", model: "test-model" }, fakeFetch);
  assert.equal((await classify("Consulta docente", "post")).decision, "approved");
  assert.equal(calls.length, 1);
  assert.match(calls[0].body, /Consulta docente/u);
  assert.doesNotMatch(calls[0].body, /example\.invalid|agenda|seguimiento|SYNTHETIC/u);
  assert.equal(normalizePreModerationResult({ decision: "rejected", categories: ["threat"], confidence: 0.7 }).decision, "pending_review");
  assert.equal(normalizePreModerationResult({ decision: "rejected", categories: ["threat"], confidence: 0.99 }).decision, "rejected");
  assert.equal(normalizePreModerationResult({ decision: "approved", categories: ["unknown-risk"], confidence: 0.99 }).decision, "pending_review");
  for (const status of [429, 503]) {
    const failed = geminiDraftClassifier({ provider: "gemini", apiKey: "SYNTHETIC", model: "test-model" }, async () => new Response("", { status }));
    assert.equal((await failed("Texto", "comment")).decision, "pending_review");
  }
  const timed = geminiDraftClassifier({ provider: "gemini", apiKey: "SYNTHETIC", model: "test-model" }, async () => { throw new DOMException("Timeout", "TimeoutError"); });
  assert.equal((await timed("Texto", "post")).decision, "pending_review");
});

test("todas las rutas de creación y edición exigen esquema y clasificación en servidor", () => {
  for (const path of [
    "../app/api/community/posts/route.ts",
    "../app/api/community/posts/[postId]/comments/route.ts",
    "../app/api/community/posts/[postId]/route.ts",
    "../app/api/community/comments/[commentId]/route.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /communityWriteDatabase\(/u, path);
    assert.match(source, /geminiDraftClassifier\(/u, path);
    assert.match(source, /getAuthenticatedAccount\(/u, path);
    assert.match(source, /isSameOriginMutation\(/u, path);
  }
});

test("una denegación admin consume el cuerpo acotado antes de la siguiente revisión", () => {
  const route = readFileSync(new URL("../app/api/admin/community/pre-moderation/route.ts", import.meta.url), "utf8")
    .split("export async function POST")[1];
  assert.ok(route);
  assert.ok(route.indexOf("await jsonObject(request)") < route.indexOf("await authorizedAdmin(request)"));
});
