-- Single-use synthetic cases for the final authorized notices canary check.
-- Canary only: bee24175-2591-4fe3-a4ed-deb7f680f615. Preserve the original cases.
INSERT INTO publications (id, source, external_id, kind, category, title, summary, level, area, junta, location, shift,
  character, circuit, source_circuit_raw, circuit_inference_source, starts_at, ends_at, status, official_url, metadata,
  content_hash, source_updated_at, first_seen_at, updated_at, last_seen_at, last_changed_at, source_published_at,
  registration_open_at, registration_close_at, expires_at, source_status, normalized_status, removed_at, circuit_confidence)
VALUES
('canary-final-20261029-p1','canary','canary-final-20261029-p1','capacitacion','capacitacion','Capacitacion canary','Resumen canary','Primario','General','Junta canary','Escuela canary','Manana','Titular','UNKNOWN','','unknown','2030-01-01T12:00:00Z','2030-01-02T12:00:00Z','vigente','https://example.test/canary-final-20261029-p1','{"entity":"commission","trainingId":"canary-final-20261029-p1","dateStatus":"confirmed","registrationHasTime":true,"availablePreCapacity":1,"registrationOpensAt":"2030-01-01T12:00:00Z","registrationClosesAt":"2030-01-02T12:00:00Z"}','canary-final-20261029-hash-p1',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'','','','2030-01-01T12:00:00Z','2030-01-02T12:00:00Z',NULL,'ACTIVE','UPCOMING',NULL,0),
('canary-final-20261029-p2','canary','canary-final-20261029-p2','designacion','designacion','Designacion canary','Resumen canary','','','','','','','UNKNOWN','','unknown',NULL,NULL,'vigente','https://example.test/canary-final-20261029-p2','{}','canary-final-20261029-hash-p2',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'','','',NULL,NULL,NULL,'ACTIVE','UPCOMING',NULL,0),
('canary-final-20261029-p3','canary','canary-final-20261029-p3','agenda','agenda','Agenda canary','Resumen canary','','','','','','','UNKNOWN','','unknown',NULL,NULL,'vigente','https://example.test/canary-final-20261029-p3','{}','canary-final-20261029-hash-p3',NULL,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP,'','','',NULL,NULL,NULL,'ACTIVE','UPCOMING',NULL,0);

INSERT INTO training_reminders (id, user_id, training_id, publication_id, opens_at, precision, advance_minutes, remind_at, notified)
VALUES ('canary-final-20261029-t1','canary-final-20261029-user-1','canary-final-20261029-p1','canary-final-20261029-p1','2030-01-01T12:00:00Z','exact',60,'2020-01-01T00:00:00Z',0);

INSERT INTO designation_tracking (id, user_id, publication_id, reminder_at, reminder_notified)
VALUES ('canary-final-20261029-d1','canary-final-20261029-user-2','canary-final-20261029-p2','2020-01-01T00:00:00Z',0);

INSERT INTO saved_publications (user_id, publication_id, in_agenda, agenda_reminder_at, agenda_reminder_notified)
VALUES ('canary-final-20261029-user-1','canary-final-20261029-p3',1,'2020-01-01T00:00:00Z',0);

INSERT INTO manual_events (id, user_id, title, starts_at, reminder_at, recurrence, reminder_minutes, reminder_notified)
VALUES ('canary-final-20261029-m1','canary-final-20261029-user-3','Evento canary','2030-01-01T12:00:00Z','2020-01-01T00:00:00Z','none',NULL,0);
