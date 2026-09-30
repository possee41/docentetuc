-- Nuevas publicaciones cerradas o vencidas detectadas en cada sincronización.
ALTER TABLE sync_state ADD COLUMN records_expired INTEGER NOT NULL DEFAULT 0;
