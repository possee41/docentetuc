// Keep this list in sync with every table that stores per-user information.
// Public publications, source snapshots and sync state are deliberately excluded.
export const userDataDeletionStatements = (userId: string) => {
  if (!userId || userId.length > 256) throw new Error("Invalid user identity");
  return [
    { table: "push_deliveries", sql: "DELETE FROM push_deliveries WHERE endpoint IN (SELECT endpoint FROM push_subscriptions WHERE user_id=?)", values: [userId] },
    { table: "manual_event_push_queue", sql: "DELETE FROM manual_event_push_queue WHERE user_id=?", values: [userId] },
    { table: "push_subscriptions", sql: "DELETE FROM push_subscriptions WHERE user_id=?", values: [userId] },
    { table: "push_preferences", sql: "DELETE FROM push_preferences WHERE user_id=?", values: [userId] },
    { table: "notifications", sql: "DELETE FROM notifications WHERE user_id=?", values: [userId] },
    { table: "training_reminders", sql: "DELETE FROM training_reminders WHERE user_id=?", values: [userId] },
    { table: "designation_tracking", sql: "DELETE FROM designation_tracking WHERE user_id=?", values: [userId] },
    { table: "saved_publications", sql: "DELETE FROM saved_publications WHERE user_id=?", values: [userId] },
    { table: "manual_events", sql: "DELETE FROM manual_events WHERE user_id=?", values: [userId] },
    { table: "ai_rate_limits", sql: "DELETE FROM ai_rate_limits WHERE substr(user_bucket, 1, length(?) + 1)=? || ':'", values: [userId, userId] },
    { table: "push_rate_limits", sql: "DELETE FROM push_rate_limits WHERE substr(user_bucket, 1, length(?) + 1)=? || ':'", values: [userId, userId] },
    { table: "profiles", sql: "DELETE FROM profiles WHERE user_id=?", values: [userId] },
  ] as const;
};
