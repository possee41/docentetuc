-- Synthetic seed for the isolated notices canary D1. No real teacher data.
-- Apply these migrations first, in order:
--   drizzle/0000_docentetuc.sql
--   drizzle/0001_training_metadata.sql
--   drizzle/0002_reminders_ai.sql
--   drizzle/0003_web_push.sql
--   migrations/0002_designations.sql
--   migrations/0003_information_agenda.sql
--   migrations/0004_agenda_reminders.sql
--   migrations/0006_manual_events.sql
--   migrations/0007_manual_event_recurrence.sql
--   migrations/0008_personal_matching_circuits.sql
--   migrations/0009_reliability_lifecycle.sql
--   migrations/0029_import_gateway_identity.sql
-- Replace REPLACE_WITH_CREATED_D1_UUID with the UUID returned by D1 creation.
INSERT INTO import_gateway_identity (id, database_name, database_id)
VALUES (1, 'docentetuc-notices-canary-1-2', 'REPLACE_WITH_CREATED_D1_UUID');

INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, junta, location, shift,
  character, circuit, source_circuit_raw, circuit_inference_source, starts_at, ends_at, status, official_url, metadata,
  content_hash, source_updated_at, first_seen_at, updated_at, last_seen_at, last_changed_at, source_published_at,
  registration_open_at, registration_close_at, expires_at, source_status, normalized_status, removed_at, circuit_confidence)
VALUES
('canary-p1','canary','canary-p1','capacitacion','capacitacion','Capacitacion canary','Resumen canary','Primario','General','Junta canary','Escuela canary','Manana','Titular','UNKNOWN','','unknown','2030-01-01T12:00:00Z','2030-01-02T12:00:00Z','vigente','https://example.test/canary-p1','{"entity":"commission","trainingId":"canary-p1","dateStatus":"confirmed","registrationHasTime":true,"availablePreCapacity":1,"registrationOpensAt":"2030-01-01T12:00:00Z","registrationClosesAt":"2030-01-02T12:00:00Z"}','canary-hash-p1',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'','','','2030-01-01T12:00:00Z','2030-01-02T12:00:00Z',NULL,'ACTIVE','UPCOMING',NULL,0),
('canary-p2','canary','canary-p2','designacion','designacion','Designacion canary','Resumen canary','','','','','','','UNKNOWN','','unknown',NULL,NULL,'vigente','https://example.test/canary-p2','{}','canary-hash-p2',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'','','',NULL,NULL,NULL,'ACTIVE','UPCOMING',NULL,0),
('canary-p3','canary','canary-p3','agenda','agenda','Agenda canary','Resumen canary','','','','','','','UNKNOWN','','unknown',NULL,NULL,'vigente','https://example.test/canary-p3','{}','canary-hash-p3',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'','','',NULL,NULL,NULL,'ACTIVE','UPCOMING',NULL,0);

INSERT INTO training_reminders (id, user_id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified)
VALUES ('canary-t1','canary-user-1','canary-p1','canary-p1','2030-01-01T12:00:00Z','exact',60,'2020-01-01T00:00:00Z',0);

INSERT INTO designation_tracking (id, user_id, publication_id, reminder_at, reminder_notified)
VALUES ('canary-d1','canary-user-2','canary-p2','2020-01-01T00:00:00Z',0);

INSERT INTO saved_publications (user_id, publication_id, in_agenda, agenda_reminder_at, agenda_reminder_notified)
VALUES ('canary-user-1','canary-p3',1,'2020-01-01T00:00:00Z',0);

INSERT INTO manual_events (id, user_id, title, starts_at, reminder_at, recurrence, reminder_minutes, reminder_notified)
VALUES ('canary-m1','canary-user-3','Evento canary','2030-01-01T12:00:00Z','2020-01-01T00:00:00Z','none',NULL,0);
