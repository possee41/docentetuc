// Public rows referenced by this user's private views; never the full catalog.
export const PERSONAL_PUBLICATIONS_QUERY = `SELECT * FROM publications WHERE id IN (
  SELECT publication_id FROM saved_publications WHERE user_id=?
  UNION SELECT publication_id FROM training_reminders WHERE user_id=?
  UNION SELECT publication_id FROM designation_tracking WHERE user_id=?
  UNION SELECT publication_id FROM notifications WHERE user_id=?
)`;
