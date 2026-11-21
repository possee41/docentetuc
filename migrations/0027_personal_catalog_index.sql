-- Allows bounded kind/id walks without scanning the full public catalog per page.
CREATE INDEX IF NOT EXISTS idx_publications_kind_id ON publications(kind, id);
