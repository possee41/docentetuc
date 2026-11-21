import type { IdentityStatement } from "./identity-link.ts";

const USER_SCOPE = "(user_id=? OR user_id IN (SELECT source_user_id FROM account_installations WHERE account_id=?))";
const SCOPE_VALUES = (accountId: string) => [accountId, accountId];

export const LAST_ADMIN_MESSAGE = "Antes de eliminar esta cuenta tenés que asignar otro administrador.";

/** Guard every write inside the SAME D1 batch, not a racy count-before-delete.
 * Keep the moderator row until the final user deletion cascades it away.
 * An active administrator means an existing account with role=admin, not an
 * unexpired login session (logging out must not change this protection).
 */
export function protectLastAdminDeletion(accountId: string, statements: IdentityStatement[]): IdentityStatement[] {
  if (statements.at(-1)?.sql !== 'DELETE FROM "user" WHERE id=?') throw new Error("Account deletion must finish with user deletion");
  const lastAdmin = `EXISTS (SELECT 1 FROM community_moderators me WHERE me.user_id=? AND me.role='admin')
    AND NOT EXISTS (SELECT 1 FROM community_moderators other JOIN "user" u ON u.id=other.user_id WHERE other.role='admin' AND other.user_id<>?)`;
  return statements.filter(({ sql }) => sql !== "DELETE FROM community_moderators WHERE user_id=?").map(({ sql, values }) => {
    // Only the fixed DELETE/UPDATE plans above and installation-ownership are accepted.
    const where = sql.indexOf(" WHERE ");
    if (where < 0 || !/^(DELETE FROM|UPDATE) /u.test(sql)) throw new Error("Unexpected deletion statement");
    return { sql: `${sql.slice(0, where)} WHERE (${sql.slice(where + 7)}) AND NOT (${lastAdmin})`, values: [...values, accountId, accountId] };
  });
}

/** Exact D1 deletion scope for one authenticated DocenteTuc account and its linked installations. */
export function accountDataDeletionStatements(accountId: string): IdentityStatement[] {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(accountId)) throw new Error("Invalid account identity");
  return [
    { sql: `DELETE FROM push_deliveries WHERE endpoint IN (SELECT endpoint FROM push_subscriptions WHERE ${USER_SCOPE})`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM manual_event_push_queue WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM push_subscriptions WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM push_preferences WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM notifications WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM training_reminders WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM designation_tracking WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM saved_publications WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM manual_events WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: "DELETE FROM ai_rate_limits WHERE substr(user_bucket,1,length(?) + 1)=? || ':' OR EXISTS (SELECT 1 FROM account_installations i WHERE i.account_id=? AND substr(ai_rate_limits.user_bucket,1,length(i.source_user_id) + 1)=i.source_user_id || ':')", values: [accountId, accountId, accountId] },
    { sql: "DELETE FROM push_rate_limits WHERE substr(user_bucket,1,length(?) + 1)=? || ':' OR EXISTS (SELECT 1 FROM account_installations i WHERE i.account_id=? AND substr(push_rate_limits.user_bucket,1,length(i.source_user_id) + 1)=i.source_user_id || ':')", values: [accountId, accountId, accountId] },
    { sql: `DELETE FROM public_profiles WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    { sql: `DELETE FROM profiles WHERE ${USER_SCOPE}`, values: SCOPE_VALUES(accountId) },
    // Community ownership is account-based only. Cascades remove comments, reports,
    // blocks and moderation history for deleted content without retaining user IDs.
    { sql: "UPDATE community_moderation_events SET actor_user_id=NULL WHERE actor_user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_rate_limits WHERE user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_reports WHERE reporter_user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_blocks WHERE blocker_user_id=? OR blocked_user_id=?", values: [accountId, accountId] },
    { sql: "DELETE FROM community_saved_posts WHERE user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_posts WHERE author_user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_comments WHERE author_user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_rules_acceptances WHERE user_id=?", values: [accountId] },
    { sql: "DELETE FROM community_moderators WHERE user_id=?", values: [accountId] },
    { sql: `DELETE FROM verification WHERE identifier=(SELECT email FROM "user" WHERE id=?)`, values: [accountId] },
    { sql: `DELETE FROM "account" WHERE userId=?`, values: [accountId] },
    { sql: `DELETE FROM "session" WHERE userId=?`, values: [accountId] },
    { sql: `DELETE FROM "user" WHERE id=?`, values: [accountId] },
  ];
}
