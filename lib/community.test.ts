import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import {
  COMMUNITY_RULES_VERSION,
  acceptCommunityRules,
  blockAuthorFromPost,
  communityStatus,
  createCommunityComment,
  createCommunityPost,
  deleteCommunityBlock,
  deleteCommunityComment,
  deleteCommunityPost,
  editCommunityComment,
  editCommunityPost,
  isCommunityModerator,
  listCommunityComments,
  listCommunityPosts,
  listCommunityPostsPage,
  listCommunitySavedPostsPage,
  listSavedCommunityPostIds,
  listOpenCommunityReports,
  moderateCommunityContent,
  purgeExpiredCommunityContent,
  reportCommunityContent,
  removeCommunitySavedPost,
  saveCommunityPost,
} from "./community.ts";
import { accountFromValidatedSession } from "./auth-identity.ts";
import { accountDataDeletionStatements } from "./account-deletion.ts";
import { adminCommunityOverview, adminReportContext, isCommunityAdmin, requireCommunityAdmin, reviewCommunityReport } from "./community-admin.ts";

const ACCOUNT_A = "550e8400-e29b-41d4-a716-446655440000";
const ACCOUNT_B = "6ba7b810-9dad-41d1-80b4-00c04fd430c8";
const EMAIL_A = "principal@example.invalid";
const EMAIL_B = "second@example.invalid";
const NOW = Date.UTC(2026, 9, 5, 15, 0);
const MIGRATION = readFileSync(new URL("../migrations/0015_community.sql", import.meta.url), "utf8");
const SAVED_MIGRATION = readFileSync(new URL("../migrations/0016_community_saved_posts.sql", import.meta.url), "utf8");
const ADMIN_MIGRATION = readFileSync(new URL("../migrations/0018_community_admin.sql", import.meta.url), "utf8");
const SAVED_ROUTE = readFileSync(new URL("../app/api/community/posts/[postId]/saved/route.ts", import.meta.url), "utf8");

type Bound = {
  first<T>(): Promise<T | null>;
  all<T>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
  runSync(): { meta: { changes: number } };
};

class SqliteD1 {
  readonly raw: DatabaseSync;

  constructor(raw: DatabaseSync) { this.raw = raw; }

  prepare(sql: string) {
    return {
      bind: (...values: unknown[]) => {
        const runSync = () => {
          const result = this.raw.prepare(sql).run(...values as (null | number | bigint | string | Uint8Array)[]);
          return { meta: { changes: Number(result.changes) } };
        };
        return {
          runSync,
          run: async () => runSync(),
          first: async <T>() => (this.raw.prepare(sql).get(...values as (null | number | bigint | string | Uint8Array)[]) as T | undefined) ?? null,
          all: async <T>() => ({ results: this.raw.prepare(sql).all(...values as (null | number | bigint | string | Uint8Array)[]) as T[] }),
        } satisfies Bound;
      },
    };
  }

  async batch(statements: unknown[]) {
    this.raw.exec("BEGIN");
    try {
      const results = statements.map((statement) => (statement as Bound).runSync());
      this.raw.exec("COMMIT");
      return results;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
}

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(`PRAGMA foreign_keys=ON;
    CREATE TABLE "user" (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, image TEXT);
    CREATE TABLE public_profiles (
      user_id TEXT PRIMARY KEY, display_name TEXT NOT NULL, avatar_id TEXT NOT NULL, bio TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE profiles (user_id TEXT PRIMARY KEY, private_data TEXT);
  `);
  raw.exec(`${MIGRATION}\n${SAVED_MIGRATION}\n${ADMIN_MIGRATION}`);
  for (const [id, email, name, publicName] of [
    [ACCOUNT_A, EMAIL_A, "Private Name A", "Docente A"],
    [ACCOUNT_B, EMAIL_B, "Private Name B", "Docente B"],
  ]) {
    raw.prepare('INSERT INTO "user"(id, name, email) VALUES (?, ?, ?)').run(id, name, email);
    raw.prepare("INSERT INTO public_profiles(user_id, display_name, avatar_id, bio) VALUES (?, ?, 'avatar_01', ?)")
      .run(id, publicName, `Bio pública de ${publicName}`);
    raw.prepare("INSERT INTO profiles(user_id, private_data) VALUES (?, ?)").run(id, `${name} - privado`);
  }
  const database = new SqliteD1(raw);
  return { raw, database };
}

async function rejectsCode(promise: Promise<unknown>, code: string) {
  await assert.rejects(promise, (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === code));
}

test("no autenticado, sin perfil público y sin aceptación no pueden publicar; la aceptación es explícita y versionada", async () => {
  const { raw, database } = setup();
  try {
    await rejectsCode(createCommunityPost(database, "", "Consulta docente"), "AUTH_REQUIRED");
    raw.prepare("DELETE FROM public_profiles WHERE user_id=?").run(ACCOUNT_B);
    await rejectsCode(createCommunityPost(database, ACCOUNT_B, "Consulta docente"), "PROFILE_REQUIRED");
    await rejectsCode(createCommunityPost(database, ACCOUNT_A, "Consulta docente"), "RULES_REQUIRED");
    await rejectsCode(acceptCommunityRules(database, ACCOUNT_A, false), "RULES_ACCEPTANCE_REQUIRED");
    const accepted = await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    assert.deepEqual(accepted, { rulesVersion: COMMUNITY_RULES_VERSION, accepted: true });
    raw.prepare("UPDATE community_rules_acceptances SET rules_version='old' WHERE user_id=?").run(ACCOUNT_A);
    await rejectsCode(createCommunityPost(database, ACCOUNT_A, "Consulta docente"), "RULES_REQUIRED");
  } finally { raw.close(); }
});

test("publicación y comentario válidos usan la cuenta de sesión, nunca IDs recibidos del cliente", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    raw.prepare('UPDATE "user" SET image=? WHERE id=?').run("https://lh3.googleusercontent.com/a/private-google-photo", ACCOUNT_A);
    const session = accountFromValidatedSession({ user: { id: ACCOUNT_A }, session: { expiresAt: new Date(NOW + 60_000) } }, NOW);
    assert.deepEqual(session, { accountId: ACCOUNT_A });
    const clientPayload = { text: "Consulta sobre designaciones docentes", userId: ACCOUNT_B, deviceId: ACCOUNT_B };
    // Route extracts only `text`; the only author argument comes from the validated session.
    const post = await createCommunityPost(database, session!.accountId, clientPayload.text, NOW);
    const storedAuthor = raw.prepare("SELECT author_user_id FROM community_posts WHERE id=?").get(post.id) as { author_user_id: string };
    assert.equal(storedAuthor.author_user_id, ACCOUNT_A);
    const comment = await createCommunityComment(database, ACCOUNT_A, post.id, "Gracias por consultar", NOW + 1000);
    assert.equal((raw.prepare("SELECT author_user_id FROM community_comments WHERE id=?").get(comment.id) as { author_user_id: string }).author_user_id, ACCOUNT_A);
    const posts = await listCommunityPosts(database, ACCOUNT_B);
    assert.equal(posts[0].author.avatarId, "avatar_01");
    assert.equal("image" in posts[0].author, false);
    const serialized = JSON.stringify(posts);
    assert.match(serialized, /Docente A/u);
    assert.doesNotMatch(serialized, new RegExp(`${EMAIL_A}|${EMAIL_B}|${ACCOUNT_A}|${ACCOUNT_B}|Private Name|googleusercontent`, "u"));
    const commentColumns = raw.prepare("PRAGMA table_info(community_comments)").all() as { name: string }[];
    assert.equal(commentColumns.some(({ name }) => name === "parent_comment_id"), false);
  } finally { raw.close(); }
});

test("el estado para el usuario no expone email, ID de cuenta ni perfil docente privado", async () => {
  const { raw, database } = setup();
  try {
    const status = await communityStatus(database, ACCOUNT_A);
    const serialized = JSON.stringify(status);
    assert.equal(status.profileConfigured, true);
    assert.deepEqual(status.publicProfile, { displayName: "Docente A", avatarId: "avatar_01", bio: "Bio pública de Docente A" });
    assert.doesNotMatch(serialized, new RegExp(`${EMAIL_A}|${ACCOUNT_A}|Private Name|privado`, "u"));
  } finally { raw.close(); }
});

test("el feed pagina por cursor en orden reciente y más comentado sin mezclar ordenamientos", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW);
    const first = await createCommunityPost(database, ACCOUNT_A, "Post primero", NOW);
    const second = await createCommunityPost(database, ACCOUNT_A, "Post segundo", NOW + 1000);
    const third = await createCommunityPost(database, ACCOUNT_A, "Post tercero", NOW + 2000);
    await createCommunityComment(database, ACCOUNT_B, first.id, "Una respuesta", NOW + 3000);
    for (let index = 0; index < 3; index += 1) await createCommunityComment(database, ACCOUNT_B, second.id, `Respuesta ${index}`, NOW + 4000 + index);
    for (let index = 0; index < 2; index += 1) await createCommunityComment(database, ACCOUNT_B, third.id, `Otra respuesta ${index}`, NOW + 5000 + index);

    const recent = await listCommunityPostsPage(database, ACCOUNT_A, { sort: "recent", pageSize: 2 });
    assert.deepEqual(recent.posts.map((post) => post.id), [third.id, second.id]);
    assert.equal(recent.hasMore, true);
    const recentNext = await listCommunityPostsPage(database, ACCOUNT_A, { sort: "recent", cursor: recent.nextCursor, pageSize: 2 });
    assert.deepEqual(recentNext.posts.map((post) => post.id), [first.id]);
    assert.equal(recentNext.hasMore, false);

    const popular = await listCommunityPostsPage(database, ACCOUNT_A, { sort: "popular", pageSize: 1 });
    assert.deepEqual(popular.posts.map((post) => post.id), [second.id]);
    const popularNext = await listCommunityPostsPage(database, ACCOUNT_A, { sort: "popular", cursor: popular.nextCursor, pageSize: 1 });
    assert.deepEqual(popularNext.posts.map((post) => post.id), [third.id]);
    await assert.rejects(listCommunityPostsPage(database, ACCOUNT_A, { sort: "recent", cursor: popular.nextCursor }), (error: unknown) => Boolean(error && typeof error === "object" && "code" in error && error.code === "INVALID_CURSOR"));
  } finally { raw.close(); }
});

test("edición y borrado solo los permite al autor; perfiles aislados y textos vacíos o largos se rechazan", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW);
    const post = await createCommunityPost(database, ACCOUNT_A, "Post original", NOW);
    await rejectsCode(editCommunityPost(database, ACCOUNT_B, post.id, "Suplantación", NOW + 1), "NOT_OWNER");
    await rejectsCode(deleteCommunityPost(database, ACCOUNT_B, post.id), "NOT_OWNER");
    const edited = await editCommunityPost(database, ACCOUNT_A, post.id, "Post corregido", NOW + 2);
    assert.equal(edited.text, "Post corregido");
    await rejectsCode(createCommunityPost(database, ACCOUNT_A, " \n ", NOW + 3), "INVALID_TEXT");
    await rejectsCode(createCommunityPost(database, ACCOUNT_A, "x".repeat(2001), NOW + 3), "TEXT_TOO_LONG");
    const comment = await createCommunityComment(database, ACCOUNT_B, post.id, "Comentario B", NOW + 4);
    await rejectsCode(editCommunityComment(database, ACCOUNT_A, comment.id, "Cambio ajeno", NOW + 5), "NOT_OWNER");
    await rejectsCode(deleteCommunityComment(database, ACCOUNT_A, comment.id), "NOT_OWNER");
    await deleteCommunityComment(database, ACCOUNT_B, comment.id);
    await deleteCommunityPost(database, ACCOUNT_A, post.id);
    assert.deepEqual(await listCommunityPosts(database, null), []);
  } finally { raw.close(); }
});

test("reportes tienen motivos acotados, no se duplican y la moderación queda solo para cuentas habilitadas", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    const post = await createCommunityPost(database, ACCOUNT_A, "Consulta docente visible", NOW);
    const comment = await createCommunityComment(database, ACCOUNT_A, post.id, "Comentario visible", NOW + 1);
    raw.prepare('UPDATE "user" SET image=? WHERE id=?').run("https://lh3.googleusercontent.com/a/private-google-photo", ACCOUNT_A);
    raw.prepare("UPDATE profiles SET private_data=? WHERE user_id=?").run("Dato docente privado - no mostrar", ACCOUNT_A);
    const report = await reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, reason: "spam" }, NOW);
    const commentReport = await reportCommunityContent(database, ACCOUNT_B, { targetType: "comment", targetId: comment.id, reason: "personal_data" }, NOW + 1);
    await rejectsCode(reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, reason: "spam" }, NOW + 1), "DUPLICATE_REPORT");
    await rejectsCode(reportCommunityContent(database, ACCOUNT_B, { targetType: "comment", targetId: comment.id, reason: "personal_data" }, NOW + 2), "DUPLICATE_REPORT");
    await rejectsCode(reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, reason: "invento" }, NOW + 1), "INVALID_REASON");
    const openReports = await listOpenCommunityReports(database);
    assert.equal(openReports.length, 2);
    assert.equal(openReports[0].author.displayName, "Docente A");
    assert.equal(openReports[0].author.avatarId, "avatar_01");
    assert.equal("bio" in openReports[0].author, false);
    const serializedReports = JSON.stringify(openReports);
    assert.doesNotMatch(serializedReports, new RegExp(`${EMAIL_A}|${EMAIL_B}|${ACCOUNT_A}|${ACCOUNT_B}|Private Name|no mostrar|googleusercontent`, "u"));
    await rejectsCode(moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, action: "hide", reason: "spam" }), "MODERATOR_REQUIRED");
    raw.prepare("INSERT INTO community_moderators(user_id) VALUES (?)").run(ACCOUNT_B);
    assert.equal(await isCommunityModerator(database, ACCOUNT_B), true);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, action: "remove", reason: "spam" }, NOW + 2);
    assert.deepEqual(await listCommunityPosts(database, null), []);
    const events = raw.prepare("SELECT action, reason FROM community_moderation_events WHERE post_id=?").all(post.id) as { action: string; reason: string }[];
    assert.deepEqual(events.map((event) => ({ ...event })), [{ action: "remove", reason: "spam" }]);
    assert.equal((raw.prepare("SELECT body FROM community_posts WHERE id=?").get(post.id) as { body: string }).body, "Contenido retirado por moderación");
    assert.equal(raw.prepare("SELECT id FROM community_reports WHERE id=?").get(report.id) !== undefined, true);
    assert.equal(raw.prepare("SELECT id FROM community_reports WHERE id=?").get(commentReport.id) !== undefined, true);
  } finally { raw.close(); }
});

test("la retención purga contenido moderado al cumplir 90 días y conserva auditoría mínima sin referencia al contenido", async () => {
  const { raw, database } = setup();
  try {
    raw.prepare("INSERT INTO community_moderators(user_id) VALUES (?)").run(ACCOUNT_B);
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW - 100 * 24 * 60 * 60 * 1000);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW - 100 * 24 * 60 * 60 * 1000);
    const oldPost = await createCommunityPost(database, ACCOUNT_A, "Texto temporal para revisión", NOW - 91 * 24 * 60 * 60 * 1000);
    const oldComment = await createCommunityComment(database, ACCOUNT_B, oldPost.id, "Comentario temporal", NOW - 91 * 24 * 60 * 60 * 1000 + 1);
    await reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: oldPost.id, reason: "spam" }, NOW - 91 * 24 * 60 * 60 * 1000 + 2);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: oldPost.id, action: "hide", reason: "spam" }, NOW - 90 * 24 * 60 * 60 * 1000);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "comment", targetId: oldComment.id, action: "hide", reason: "other" }, NOW - 90 * 24 * 60 * 60 * 1000);

    const recentPost = await createCommunityPost(database, ACCOUNT_A, "Todavía en revisión", NOW - 89 * 24 * 60 * 60 * 1000);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: recentPost.id, action: "hide", reason: "off_topic" }, NOW - 89 * 24 * 60 * 60 * 1000);

    const result = await purgeExpiredCommunityContent(database, NOW);
    assert.equal(result.postsPurged, 1);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_posts WHERE id=?").get(oldPost.id) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_comments WHERE id=?").get(oldComment.id) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_posts WHERE id=?").get(recentPost.id) as { n: number }).n, 1);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_reports WHERE post_id=?").get(oldPost.id) as { n: number }).n, 0);
    const retainedAudit = raw.prepare("SELECT actor_user_id, target_type, post_id, comment_id, action, reason, created_at FROM community_moderation_events ORDER BY created_at").all() as Record<string, unknown>[];
    assert.equal(retainedAudit.length, 3);
    const detachedAudit = retainedAudit.filter((event) => event.post_id === null && event.comment_id === null);
    assert.equal(detachedAudit.length, 2);
    assert.equal(retainedAudit.some((event) => event.post_id === recentPost.id), true);
    assert.ok(detachedAudit.every((event) => event.action === "hide" && typeof event.reason === "string" && typeof event.created_at === "string"));
    const again = await purgeExpiredCommunityContent(database, NOW);
    assert.equal(again.postsPurged, 0);
  } finally { raw.close(); }
});

test("el límite servidor de publicaciones es 5 por cuenta y ventana de una hora", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    for (let index = 0; index < 5; index++) await createCommunityPost(database, ACCOUNT_A, `Consulta ${index}`, NOW + index);
    await rejectsCode(createCommunityPost(database, ACCOUNT_A, "Sexta consulta", NOW + 10), "RATE_LIMITED");
    await createCommunityPost(database, ACCOUNT_A, "Nueva ventana", NOW + 60 * 60 * 1000);
  } finally { raw.close(); }
});

test("los límites servidor también capean comentarios (30) y reportes (10) por ventana", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    const post = await createCommunityPost(database, ACCOUNT_A, "Publicación para límites", NOW);
    for (let index = 0; index < 30; index++) await createCommunityComment(database, ACCOUNT_A, post.id, `Comentario ${index}`, NOW + index);
    await rejectsCode(createCommunityComment(database, ACCOUNT_A, post.id, "Comentario 31", NOW + 31), "RATE_LIMITED");

    const comments = await listCommunityComments(database, post.id, null);
    for (let index = 0; index < 10; index++) {
      await reportCommunityContent(database, ACCOUNT_B, { targetType: "comment", targetId: comments[index].id, reason: "spam" }, NOW + 100 + index);
    }
    await rejectsCode(reportCommunityContent(database, ACCOUNT_B, { targetType: "comment", targetId: comments[10].id, reason: "spam" }, NOW + 120), "RATE_LIMITED");
  } finally { raw.close(); }
});

test("bloqueo oculta contenido entre las cuentas sin exponer el ID de la persona bloqueada", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    const post = await createCommunityPost(database, ACCOUNT_A, "Post de A", NOW);
    const block = await blockAuthorFromPost(database, ACCOUNT_B, post.id, NOW + 1);
    assert.deepEqual(await listCommunityPosts(database, ACCOUNT_B), []);
    assert.equal((await listCommunityPosts(database, ACCOUNT_A)).length, 1);
    const blocks = await import("./community.ts").then(({ listCommunityBlocks }) => listCommunityBlocks(database, ACCOUNT_B));
    assert.equal(blocks[0].profile.displayName, "Docente A");
    assert.doesNotMatch(JSON.stringify(blocks), new RegExp(`${ACCOUNT_A}|${EMAIL_A}`, "u"));
    await deleteCommunityBlock(database, ACCOUNT_B, block.id);
    assert.equal((await listCommunityPosts(database, ACCOUNT_B)).length, 1);
  } finally { raw.close(); }
});

test("/admin exige rol explícito del servidor; moderador y role falso del cliente no bastan", async () => {
  const { raw, database } = setup();
  try {
    await rejectsCode(requireCommunityAdmin(database, null), "AUTH_REQUIRED");
    await rejectsCode(requireCommunityAdmin(database, ACCOUNT_A), "MODERATOR_REQUIRED");
    raw.prepare("INSERT INTO community_moderators(user_id) VALUES(?)").run(ACCOUNT_A);
    assert.equal(await isCommunityModerator(database, ACCOUNT_A), true);
    assert.equal(await isCommunityAdmin(database, ACCOUNT_A), false);
    await rejectsCode(requireCommunityAdmin(database, ACCOUNT_A), "MODERATOR_REQUIRED");
    raw.prepare("UPDATE community_moderators SET role='admin' WHERE user_id=?").run(ACCOUNT_A);
    assert.equal(await requireCommunityAdmin(database, ACCOUNT_A), ACCOUNT_A);
    assert.equal(await isCommunityAdmin(database, ACCOUNT_B), false);
    assert.throws(() => raw.prepare("UPDATE community_moderators SET role='owner' WHERE user_id=?").run(ACCOUNT_A));
  } finally { raw.close(); }
});

test("panel admin usa identidad pública, audita reportes y no recupera contenido oculto desde Guardadas", async () => {
  const { raw, database } = setup();
  try {
    raw.prepare("UPDATE \"user\" SET image=? WHERE id=?").run("https://lh3.googleusercontent.com/a/private", ACCOUNT_A);
    raw.prepare("UPDATE profiles SET private_data='materias, cargos y circuitos privados' WHERE user_id=?").run(ACCOUNT_A);
    raw.prepare("INSERT INTO community_moderators(user_id,role) VALUES(?,'admin')").run(ACCOUNT_B);
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    const post = await createCommunityPost(database, ACCOUNT_A, "Consulta docente sintética", NOW);
    const comment = await createCommunityComment(database, ACCOUNT_A, post.id, "Respuesta sintética", NOW + 1);
    await saveCommunityPost(database, ACCOUNT_B, post.id, NOW + 2);
    const report = await reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, reason: "spam" }, NOW + 3);
    const commentReport = await reportCommunityContent(database, ACCOUNT_B, { targetType: "comment", targetId: comment.id, reason: "other" }, NOW + 4);
    const overview = await adminCommunityOverview(database);
    assert.equal(overview.reports.length, 2);
    const context = await adminReportContext(database, commentReport.id);
    assert.equal(context.comments.length, 1);
    const serialized = JSON.stringify({ overview, context });
    assert.doesNotMatch(serialized, /example\.invalid|googleusercontent|materias, cargos|accessToken|refreshToken|sessionToken|community_saved_posts|Private Name/u);
    await rejectsCode(reviewCommunityReport(database, ACCOUNT_A, report.id, "dismiss"), "MODERATOR_REQUIRED");
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, action: "hide", reason: "spam" }, NOW + 5);
    assert.equal((await listCommunityPosts(database, null)).length, 0);
    assert.equal((await listCommunitySavedPostsPage(database, ACCOUNT_B)).posts.length, 0);
    assert.equal((await adminCommunityOverview(database)).hidden.length, 1);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: post.id, action: "restore", reason: "other" }, NOW + 6);
    assert.equal((await listCommunityPosts(database, null)).length, 1);
    await reviewCommunityReport(database, ACCOUNT_B, commentReport.id, "resolve");
    assert.equal((raw.prepare("SELECT status FROM community_reports WHERE id=?").get(commentReport.id) as { status: string }).status, "reviewed");
    const secondPost = await createCommunityPost(database, ACCOUNT_A, "Otro caso sintético", NOW + 7);
    const secondReport = await reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: secondPost.id, reason: "off_topic" }, NOW + 8);
    await reviewCommunityReport(database, ACCOUNT_B, secondReport.id, "dismiss");
    assert.equal((raw.prepare("SELECT status FROM community_reports WHERE id=?").get(secondReport.id) as { status: string }).status, "dismissed");
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_report_reviews").get() as { n: number }).n, 2);
  } finally { raw.close(); }
});

test("la eliminación de cuenta contempla relaciones sociales, anonimiza autores de auditoría y conserva a B", async () => {
  const { raw, database } = setup();
  try {
    raw.exec(`CREATE TABLE "account" (id TEXT PRIMARY KEY, userId TEXT);
      CREATE TABLE "session" (id TEXT PRIMARY KEY, userId TEXT);
      CREATE TABLE verification (identifier TEXT);
      CREATE TABLE account_installations (device_id TEXT PRIMARY KEY, source_user_id TEXT UNIQUE, account_id TEXT);
      CREATE TABLE push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT);
      CREATE TABLE push_deliveries (endpoint TEXT, event_key TEXT);
      CREATE TABLE manual_event_push_queue (user_id TEXT);
      CREATE TABLE push_preferences (user_id TEXT);
      CREATE TABLE notifications (user_id TEXT);
      CREATE TABLE training_reminders (user_id TEXT);
      CREATE TABLE designation_tracking (user_id TEXT);
      CREATE TABLE saved_publications (user_id TEXT);
      CREATE TABLE manual_events (user_id TEXT);
      CREATE TABLE ai_rate_limits (user_bucket TEXT PRIMARY KEY);
      CREATE TABLE push_rate_limits (user_bucket TEXT PRIMARY KEY);`);
    raw.prepare("INSERT INTO \"account\" VALUES ('a-google', ?), ('b-google', ?)").run(ACCOUNT_A, ACCOUNT_B);
    raw.prepare("INSERT INTO \"session\" VALUES ('a-session', ?), ('b-session', ?)").run(ACCOUNT_A, ACCOUNT_B);
    raw.prepare("INSERT INTO account_installations VALUES ('device-a', ?, ?), ('device-b', ?, ?)").run(ACCOUNT_A, ACCOUNT_A, ACCOUNT_B, ACCOUNT_B);
    raw.prepare("INSERT INTO community_rules_acceptances(user_id, rules_version) VALUES (?, '1'), (?, '1')").run(ACCOUNT_A, ACCOUNT_B);
    const postA = await createCommunityPost(database, ACCOUNT_A, "Post A", NOW);
    const postB = await createCommunityPost(database, ACCOUNT_B, "Post B", NOW);
    await createCommunityComment(database, ACCOUNT_A, postB.id, "Comentario A en B", NOW + 1);
    await createCommunityComment(database, ACCOUNT_B, postA.id, "Comentario B en A", NOW + 2);
    await reportCommunityContent(database, ACCOUNT_A, { targetType: "post", targetId: postB.id, reason: "spam" }, NOW + 3);
    await reportCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: postA.id, reason: "other" }, NOW + 4);
    await blockAuthorFromPost(database, ACCOUNT_A, postB.id, NOW + 5);
    await blockAuthorFromPost(database, ACCOUNT_B, postA.id, NOW + 6);
    raw.prepare("INSERT INTO community_moderators(user_id) VALUES (?), (?)").run(ACCOUNT_A, ACCOUNT_B);
    await moderateCommunityContent(database, ACCOUNT_A, { targetType: "post", targetId: postB.id, action: "hide", reason: "spam" }, NOW + 7);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: postA.id, action: "hide", reason: "other" }, NOW + 8);

    for (const { sql, values } of accountDataDeletionStatements(ACCOUNT_A)) raw.prepare(sql).run(...values as (string | number | null)[]);

    assert.equal((raw.prepare('SELECT count(*) AS n FROM "user" WHERE id=?').get(ACCOUNT_A) as { n: number }).n, 0);
    assert.equal((raw.prepare('SELECT count(*) AS n FROM "user" WHERE id=?').get(ACCOUNT_B) as { n: number }).n, 1);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_posts WHERE author_user_id=?").get(ACCOUNT_A) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_posts WHERE id=?").get(postB.id) as { n: number }).n, 1);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_comments WHERE author_user_id=?").get(ACCOUNT_A) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_comments WHERE post_id=?").get(postA.id) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_reports").get() as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_blocks").get() as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_rules_acceptances WHERE user_id=?").get(ACCOUNT_A) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_moderators WHERE user_id=?").get(ACCOUNT_A) as { n: number }).n, 0);
    assert.equal((raw.prepare("SELECT actor_user_id FROM community_moderation_events WHERE post_id=?").get(postB.id) as { actor_user_id: string | null }).actor_user_id, null);
    assert.equal((raw.prepare("SELECT count(*) AS n FROM community_moderation_events WHERE post_id=?").get(postA.id) as { n: number }).n, 0);
    assert.equal((raw.prepare('SELECT count(*) AS n FROM "session" WHERE userId=?').get(ACCOUNT_A) as { n: number }).n, 0);
  } finally { raw.close(); }
});

test("Guardadas es privada, idempotente, paginada y solo usa autor/avatar del perfil público", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW);
    const postA = await createCommunityPost(database, ACCOUNT_A, "Consulta privada guardada", NOW);
    const postB = await createCommunityPost(database, ACCOUNT_B, "Otra consulta guardada", NOW + 1);
    await rejectsCode(saveCommunityPost(database, "", postA.id, NOW), "AUTH_REQUIRED");

    assert.deepEqual(await saveCommunityPost(database, ACCOUNT_A, postA.id, NOW + 2), { saved: true, alreadySaved: false });
    assert.deepEqual(await saveCommunityPost(database, ACCOUNT_A, postA.id, NOW + 3), { saved: true, alreadySaved: true });
    assert.deepEqual(await saveCommunityPost(database, ACCOUNT_B, postB.id, NOW + 4), { saved: true, alreadySaved: false });
    assert.equal((raw.prepare("SELECT COUNT(*) AS count FROM community_saved_posts WHERE user_id=? AND post_id=?").get(ACCOUNT_A, postA.id) as { count: number }).count, 1);

    const [pageA, pageB] = await Promise.all([
      listCommunitySavedPostsPage(database, ACCOUNT_A),
      listCommunitySavedPostsPage(database, ACCOUNT_B),
    ]);
    assert.deepEqual(pageA.posts.map((post) => post.id), [postA.id]);
    assert.deepEqual(pageB.posts.map((post) => post.id), [postB.id]);
    assert.deepEqual(await listSavedCommunityPostIds(database, ACCOUNT_A, [postA.id, postB.id]), [postA.id]);
    assert.deepEqual(await listSavedCommunityPostIds(database, ACCOUNT_B, [postA.id, postB.id]), [postB.id]);

    const publicFeed = await listCommunityPosts(database, ACCOUNT_A);
    assert.doesNotMatch(JSON.stringify(publicFeed), /savedAt|savedBy|savedCount|community_saved_posts|principal@example|second@example|Private Name|550e8400-e29b-41d4-a716-446655440000|6ba7b810-9dad-41d1-80b4-00c04fd430c8/u);
    const serializedSaved = JSON.stringify(pageA);
    assert.match(serializedSaved, /Docente A/u);
    assert.match(serializedSaved, /avatar_01/u);
    assert.doesNotMatch(serializedSaved, /principal@example|Private Name|550e8400-e29b-41d4-a716-446655440000|provider|googleId|email/u);
    assert.equal("savedAt" in pageA, false);
    assert.equal("savedCount" in pageA, false);
    assert.equal((await listCommunitySavedPostsPage(database, ACCOUNT_A, { pageSize: 1 })).hasMore, false);
    assert.notEqual(postB.id, pageA.posts[0].id);
  } finally { raw.close(); }
});

test("Guardadas conserva el texto actual, ordena por guardado reciente y pagina sin duplicados", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW);
    const older = await createCommunityPost(database, ACCOUNT_A, "Texto inicial", NOW);
    const newer = await createCommunityPost(database, ACCOUNT_B, "Publicación reciente", NOW + 1);
    await saveCommunityPost(database, ACCOUNT_A, older.id, NOW + 10);
    await saveCommunityPost(database, ACCOUNT_A, newer.id, NOW + 20);
    await editCommunityPost(database, ACCOUNT_A, older.id, "Texto actualizado", NOW + 30);

    const first = await listCommunitySavedPostsPage(database, ACCOUNT_A, { pageSize: 1 });
    assert.equal(first.posts[0].id, newer.id);
    assert.equal(first.hasMore, true);
    assert.ok(first.nextCursor);
    const second = await listCommunitySavedPostsPage(database, ACCOUNT_A, { pageSize: 1, cursor: first.nextCursor });
    assert.equal(second.posts[0].id, older.id);
    assert.equal(second.posts[0].text, "Texto actualizado");
    assert.equal(second.hasMore, false);
    assert.equal(new Set([...first.posts, ...second.posts].map((post) => post.id)).size, 2);
  } finally { raw.close(); }
});

test("Guardadas no elude moderación, bloqueos ni eliminación de publicaciones", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW);
    const moderated = await createCommunityPost(database, ACCOUNT_A, "Contenido moderado", NOW);
    const blocked = await createCommunityPost(database, ACCOUNT_B, "Contenido bloqueado", NOW + 1);
    const removable = await createCommunityPost(database, ACCOUNT_B, "Contenido eliminado", NOW + 2);
    for (const post of [moderated, blocked, removable]) await saveCommunityPost(database, ACCOUNT_A, post.id, NOW + 3);
    assert.equal((await listCommunitySavedPostsPage(database, ACCOUNT_A)).posts.length, 3);
    raw.prepare("INSERT INTO community_moderators(user_id) VALUES (?)").run(ACCOUNT_B);
    await moderateCommunityContent(database, ACCOUNT_B, { targetType: "post", targetId: moderated.id, action: "hide", reason: "spam" }, NOW + 4);
    await rejectsCode(saveCommunityPost(database, ACCOUNT_A, moderated.id, NOW + 4), "NOT_FOUND");
    await blockAuthorFromPost(database, ACCOUNT_A, blocked.id, NOW + 5);
    assert.deepEqual((await listCommunitySavedPostsPage(database, ACCOUNT_A)).posts, []);
    await deleteCommunityPost(database, ACCOUNT_B, removable.id);
    assert.equal((raw.prepare("SELECT COUNT(*) AS count FROM community_saved_posts WHERE post_id=?").get(removable.id) as { count: number }).count, 0);
    assert.deepEqual((await listCommunitySavedPostsPage(database, ACCOUNT_A)).posts, []);
  } finally { raw.close(); }
});

test("quitar de Guardadas es privado e idempotente", async () => {
  const { raw, database } = setup();
  try {
    await acceptCommunityRules(database, ACCOUNT_A, true, NOW);
    await acceptCommunityRules(database, ACCOUNT_B, true, NOW);
    const post = await createCommunityPost(database, ACCOUNT_A, "Importante", NOW);
    await saveCommunityPost(database, ACCOUNT_A, post.id, NOW + 1);
    await saveCommunityPost(database, ACCOUNT_B, post.id, NOW + 2);
    assert.deepEqual(await removeCommunitySavedPost(database, ACCOUNT_A, post.id), { saved: false });
    assert.deepEqual(await removeCommunitySavedPost(database, ACCOUNT_A, post.id), { saved: false });
    assert.deepEqual((await listCommunitySavedPostsPage(database, ACCOUNT_A)).posts, []);
    assert.deepEqual((await listCommunitySavedPostsPage(database, ACCOUNT_B)).posts.map((item) => item.id), [post.id]);
  } finally { raw.close(); }
});

test("el endpoint Guardadas toma al propietario solo de la sesión servidor y no procesa IDs del cliente", () => {
  assert.match(SAVED_ROUTE, /getAuthenticatedAccount\(request\)/u);
  assert.match(SAVED_ROUTE, /account\.accountId/u);
  assert.doesNotMatch(SAVED_ROUTE, /request\.json\(|body\.userId|body\.accountId|deviceId|googleId/u);
});
