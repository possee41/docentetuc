-- Apply only to D1 0979f2c2-0e96-4b5c-811b-adcccc2dbd6d after an export.
-- Requires 0032_fdci_import_checkpoint.sql and 0101_public_snapshot_revision.sql first.
-- Preflight: zero rows with this ID prefix and no existing FDCI publications.
WITH RECURSIVE fixture(n) AS (
  SELECT 1 UNION ALL SELECT n + 1 FROM fixture WHERE n < 152
)
INSERT INTO publications (
  id, source, external_id, kind, category, title, summary, starts_at, ends_at,
  status, official_url, content_hash, metadata, registration_open_at,
  registration_close_at, source_status, normalized_status, updated_at
)
SELECT
  'fdci:canary:snapshot:20261127:' || printf('%03d', n),
  'Capacitación Docente', 'fdci-canary-20261127-' || printf('%03d', n),
  'capacitacion', 'Ensayo sintético',
  'Capacitación FDCI sintética ' || printf('%03d', n),
  substr(hex(zeroblob(2500)), 1, 5000),
  CASE WHEN n <= 76 THEN date('now', '+7 days') ELSE date('now', '-1 day') END || 'T09:00:00-03:00',
  CASE WHEN n <= 76 THEN date('now', '+10 days') ELSE date('now', '+2 days') END || 'T08:00:00-03:00',
  CASE WHEN n <= 76 THEN 'próximamente' ELSE 'inscripción abierta' END,
  'https://example.invalid/fdci-canary/' || n,
  'fdci-public-snapshot-canary-20261127',
  json_object('entity', 'commission', 'trainingId', 'canary-' || n,
    'commissionId', 'canary-' || n, 'source', 'Ensayo sintético',
    'dateStatus', 'confirmed', 'registrationHasTime', true,
    'registrationOpensAt', (CASE WHEN n <= 76 THEN date('now', '+7 days') ELSE date('now', '-1 day') END) || 'T09:00:00-03:00',
    'registrationClosesAt', (CASE WHEN n <= 76 THEN date('now', '+10 days') ELSE date('now', '+2 days') END) || 'T08:00:00-03:00'),
  (CASE WHEN n <= 76 THEN date('now', '+7 days') ELSE date('now', '-1 day') END) || 'T09:00:00-03:00',
  (CASE WHEN n <= 76 THEN date('now', '+10 days') ELSE date('now', '+2 days') END) || 'T08:00:00-03:00',
  CASE WHEN n <= 76 THEN 'próximamente' ELSE 'inscripción abierta' END,
  CASE WHEN n <= 76 THEN 'UPCOMING' ELSE 'ACTIVE' END,
  datetime('now')
FROM fixture JOIN import_gateway_identity AS guard ON guard.id = 1
  AND guard.database_name = 'docentetuc-sources-canary-1-2'
  AND guard.database_id = '0979f2c2-0e96-4b5c-811b-adcccc2dbd6d';
