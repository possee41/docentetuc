-- Reuse each manual reminder queue row as its private internal notice.
-- Existing/completed queue entries stay hidden: no historical backfill.
ALTER TABLE manual_event_push_queue ADD COLUMN internal_notice INTEGER NOT NULL DEFAULT 0;
ALTER TABLE manual_event_push_queue ADD COLUMN internal_read INTEGER NOT NULL DEFAULT 0;
