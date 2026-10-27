-- Apply only to a newly created docentetuc-push-canary-1-2 D1.
CREATE TABLE push_canary_identity(marker TEXT PRIMARY KEY);
INSERT INTO push_canary_identity(marker) VALUES('docentetuc-push-canary-1-2');
CREATE TABLE publications(id TEXT PRIMARY KEY,title TEXT);
CREATE TABLE notifications(id INTEGER PRIMARY KEY,user_id TEXT,publication_id TEXT,type TEXT,scheduled_at TEXT,created_at TEXT,attempted_at TEXT,accepted_at TEXT,failure_reason TEXT,read INTEGER DEFAULT 0);
CREATE INDEX idx_notifications_scheduled ON notifications(scheduled_at,read);
CREATE INDEX idx_notifications_user_read ON notifications(user_id,read);
CREATE TABLE push_subscriptions(endpoint TEXT PRIMARY KEY,user_id TEXT,p256dh TEXT,auth TEXT,expiration_time INTEGER,active INTEGER,created_at TEXT,updated_at TEXT);
CREATE INDEX idx_push_subscriptions_user ON push_subscriptions(user_id,active);
CREATE TABLE push_preferences(user_id TEXT PRIMARY KEY,enabled INTEGER,vacancies INTEGER,trainings INTEGER,commissions INTEGER,reminders INTEGER,date_changes INTEGER,closing_soon INTEGER,boards INTEGER,designation_exact INTEGER,designation_partial INTEGER,designation_roles INTEGER,quiet_start TEXT,quiet_end TEXT,timezone TEXT);
CREATE TABLE push_deliveries(id INTEGER PRIMARY KEY,endpoint TEXT,notification_id INTEGER,event_key TEXT,status TEXT,attempts INTEGER,next_attempt_at TEXT,attempted_at TEXT,scheduled_at TEXT,sent_at TEXT,accepted_at TEXT,failure_reason TEXT,last_error TEXT,UNIQUE(endpoint,event_key));
CREATE INDEX idx_push_deliveries_retry ON push_deliveries(status,next_attempt_at);
CREATE TABLE manual_event_push_queue(id INTEGER PRIMARY KEY,user_id TEXT,event_id TEXT,title TEXT,created_at TEXT);
CREATE INDEX idx_manual_event_push_due ON manual_event_push_queue(created_at,user_id);
