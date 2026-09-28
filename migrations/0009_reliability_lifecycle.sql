ALTER TABLE publications ADD COLUMN last_seen_at TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN last_changed_at TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN source_published_at TEXT;
ALTER TABLE publications ADD COLUMN registration_open_at TEXT;
ALTER TABLE publications ADD COLUMN registration_close_at TEXT;
ALTER TABLE publications ADD COLUMN expires_at TEXT;
ALTER TABLE publications ADD COLUMN source_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE publications ADD COLUMN normalized_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE publications ADD COLUMN removed_at TEXT;
ALTER TABLE publications ADD COLUMN circuit_confidence INTEGER NOT NULL DEFAULT 0;

UPDATE publications
SET last_changed_at=COALESCE(NULLIF(updated_at, ''), NULLIF(first_seen_at, ''), CURRENT_TIMESTAMP),
    source_status=CASE WHEN status IS NULL OR status='' THEN 'UNKNOWN' ELSE UPPER(status) END,
    normalized_status=CASE
      WHEN lower(status) IN ('cerrada','inscripción cerrada','finalizada','vencida') THEN 'CLOSED'
      WHEN lower(status) IN ('próximamente','proximamente') THEN 'UPCOMING'
      WHEN lower(status) IN ('vigente','inscripción abierta','verificado') THEN 'ACTIVE'
      ELSE 'UNKNOWN'
    END,
    registration_open_at=CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.registrationOpensAt') END,
    registration_close_at=CASE WHEN json_valid(metadata) THEN json_extract(metadata, '$.registrationClosesAt') END,
    expires_at=CASE
      WHEN kind='vacante' THEN ends_at
      WHEN kind='capacitacion' AND json_valid(metadata) THEN json_extract(metadata, '$.courseEndsAt')
      ELSE NULL
    END,
    circuit_confidence=CASE
      WHEN circuit_inference_source='explicit' THEN 100
      WHEN circuit_inference_source='department' THEN 90
      WHEN circuit_inference_source='locality' THEN 75
      ELSE 0
    END
WHERE last_seen_at='';

UPDATE publications
SET source_published_at=starts_at
WHERE source='SIME' AND source_published_at IS NULL AND starts_at IS NOT NULL;

UPDATE publications SET normalized_status=CASE
  WHEN expires_at IS NOT NULL AND datetime(expires_at)<datetime('now') THEN 'EXPIRED'
  WHEN registration_close_at IS NOT NULL AND datetime(registration_close_at)<datetime('now') THEN 'CLOSED'
  WHEN registration_open_at IS NOT NULL AND datetime(registration_open_at)>datetime('now') AND json_valid(metadata) AND lower(COALESCE(json_extract(metadata,'$.dateStatus'),'')) IN ('confirmed','course_confirmed') THEN 'UPCOMING'
  ELSE normalized_status
END
WHERE normalized_status NOT IN ('REMOVED_FROM_SOURCE');

-- Catalogue-wide/tentative dates and parser-derived status labels must not be
-- presented as an individual course lifecycle before its dates are confirmed.
UPDATE publications
SET normalized_status='UNKNOWN'
WHERE kind='capacitacion'
  AND json_valid(metadata)
  AND lower(COALESCE(json_extract(metadata,'$.dateStatus'),'')) IN ('tentative','general_window','unknown')
  AND normalized_status<>'REMOVED_FROM_SOURCE';

-- Older INFoD imports copied dates from the catalogue heading onto every
-- course. Preserve those values as a general catalogue window, not as each
-- course's own enrolment/course dates or alert-driving schedule.
UPDATE publications
SET metadata=json_remove(
      json_set(metadata,
        '$.generalWindowOpensAt', json_extract(metadata,'$.registrationOpensAt'),
        '$.generalWindowClosesAt', json_extract(metadata,'$.registrationClosesAt'),
        '$.generalWindowCourseStartsAt', json_extract(metadata,'$.courseStartsAt'),
        '$.dateStatus', CASE
          WHEN json_extract(metadata,'$.registrationOpensAt') IS NOT NULL
            OR json_extract(metadata,'$.registrationClosesAt') IS NOT NULL
            OR json_extract(metadata,'$.courseStartsAt') IS NOT NULL
          THEN 'general_window' ELSE 'unknown' END
      ),
      '$.registrationOpensAt', '$.registrationClosesAt', '$.courseStartsAt'
    ),
    registration_open_at=NULL, registration_close_at=NULL, starts_at=NULL,
    ends_at=NULL, expires_at=NULL, status='consultar', source_status='CONSULTAR', normalized_status='UNKNOWN'
WHERE source='INFoD / AulaS-TIC'
  AND kind='capacitacion'
  AND json_valid(metadata)
  AND lower(COALESCE(json_extract(metadata,'$.dateStatus'),''))='confirmed';

ALTER TABLE sync_state ADD COLUMN last_attempt_at TEXT;
ALTER TABLE sync_state ADD COLUMN last_successful_sync_at TEXT;
ALTER TABLE sync_state ADD COLUMN last_content_change_at TEXT;
ALTER TABLE sync_state ADD COLUMN records_created INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN records_updated INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN records_removed INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_state ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE sync_state ADD COLUMN error_code TEXT;
ALTER TABLE sync_state ADD COLUMN error_message TEXT;
ALTER TABLE sync_state ADD COLUMN parser_version TEXT NOT NULL DEFAULT '1';
UPDATE sync_state SET last_successful_sync_at=synced_at, last_attempt_at=synced_at, sync_status=CASE WHEN error IS NULL THEN 'OK' ELSE 'PARSE_ERROR' END;

ALTER TABLE notifications ADD COLUMN dedupe_key TEXT NOT NULL DEFAULT '';
ALTER TABLE notifications ADD COLUMN scheduled_at TEXT;
ALTER TABLE notifications ADD COLUMN attempted_at TEXT;
ALTER TABLE notifications ADD COLUMN accepted_at TEXT;
ALTER TABLE notifications ADD COLUMN failure_reason TEXT;
UPDATE notifications SET dedupe_key='legacy:' || id WHERE dedupe_key='';
DROP INDEX IF EXISTS idx_notifications_unique;
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedupe ON notifications(user_id, dedupe_key) WHERE dedupe_key<>'';

ALTER TABLE push_deliveries ADD COLUMN scheduled_at TEXT;
ALTER TABLE push_deliveries ADD COLUMN attempted_at TEXT;
ALTER TABLE push_deliveries ADD COLUMN accepted_at TEXT;
ALTER TABLE push_deliveries ADD COLUMN failure_reason TEXT;
UPDATE push_deliveries SET scheduled_at=created_at, accepted_at=sent_at, failure_reason=last_error WHERE 1;

CREATE INDEX IF NOT EXISTS idx_publications_lifecycle ON publications(normalized_status, kind, source);
CREATE INDEX IF NOT EXISTS idx_sync_state_status ON sync_state(sync_status, last_successful_sync_at);
CREATE INDEX IF NOT EXISTS idx_notifications_scheduled ON notifications(scheduled_at, read);
