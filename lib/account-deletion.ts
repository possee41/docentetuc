import type { IdentityStatement } from "./identity-link.ts";

const USER_SCOPE = "(user_id=? OR user_id IN (SELECT source_user_id FROM account_installations WHERE account_id=?))";
const SCOPE_VALUES = (accountId: string) => [accountId, accountId];

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
