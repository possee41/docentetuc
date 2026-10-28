-- A deployed import gateway must find the exact database it was approved for.
-- The row is intentionally absent until the isolated or production target is verified.
CREATE TABLE IF NOT EXISTS import_gateway_identity (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  database_name TEXT NOT NULL,
  database_id TEXT NOT NULL
);
