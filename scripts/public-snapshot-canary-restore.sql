-- Only after the test gate is closed and the authorized object's deleteAll() succeeds.
-- Preflight must prove these two tables were absent before setup.
DELETE FROM publications WHERE id LIKE 'fdci:canary:snapshot:20261127:%'
  AND source = 'Capacitación Docente'
  AND content_hash = 'fdci-public-snapshot-canary-20261127'
  AND EXISTS (SELECT 1 FROM import_gateway_identity WHERE id=1
    AND database_name='docentetuc-sources-canary-1-2'
    AND database_id='0979f2c2-0e96-4b5c-811b-adcccc2dbd6d');
DROP TRIGGER public_snapshot_pub_insert;
DROP TRIGGER public_snapshot_pub_update;
DROP TRIGGER public_snapshot_pub_delete;
DROP TRIGGER public_snapshot_sync_insert;
DROP TRIGGER public_snapshot_sync_update;
DROP TRIGGER public_snapshot_sync_delete;
DROP TABLE public_snapshot_revision;
DROP TABLE fdci_import_checkpoint;
