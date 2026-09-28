ALTER TABLE profiles ADD COLUMN characters TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN circuits TEXT NOT NULL DEFAULT '';
ALTER TABLE profiles ADD COLUMN personal_match_threshold INTEGER NOT NULL DEFAULT 85;

ALTER TABLE publications ADD COLUMN circuit TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE publications ADD COLUMN source_circuit_raw TEXT NOT NULL DEFAULT '';
ALTER TABLE publications ADD COLUMN circuit_inference_source TEXT NOT NULL DEFAULT 'unknown';
