-- Single-use, two synthetic cases. Only D1 bee24175-2591-4fe3-a4ed-deb7f680f615.
-- Reuse the original synthetic course without changing it or previous reminders.
INSERT INTO training_reminders
  (id,user_id,training_id,publication_id,opens_at,precision,advance_minutes,remind_at,notified)
SELECT 'canary-cpu2-20261029-t1','canary-cpu2-20261029-user1',training_id,
  publication_id,opens_at,precision,advance_minutes,remind_at,0
FROM training_reminders WHERE id='canary-t1';

INSERT INTO manual_events
  (id,user_id,title,starts_at,reminder_at,recurrence,reminder_minutes,reminder_notified)
VALUES ('canary-cpu2-20261029-m1','canary-cpu2-20261029-user2',
  'Evento sintetico CPU limit 2','2030-01-01T12:00:00Z','2020-01-01T00:00:00Z','none',NULL,0);
