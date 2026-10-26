// The home payload is a recent selection. /api/search browses the full public catalog.
export const APP_PUBLICATIONS_QUERY = `SELECT * FROM publications WHERE id IN (
  SELECT id FROM (SELECT id FROM publications WHERE kind='informacion'
    AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.canonicalId') IS NULL ELSE 1 END)
    ORDER BY updated_at DESC, id DESC LIMIT 40)
  UNION ALL
  SELECT id FROM (SELECT id FROM publications WHERE kind IN ('vacante','capacitacion','junta')
    AND (CASE WHEN json_valid(metadata) THEN json_extract(metadata,'$.official.canonicalId') IS NULL ELSE 1 END)
    ORDER BY CASE WHEN ends_at >= datetime('now') THEN 0 WHEN starts_at >= datetime('now') THEN 1 ELSE 2 END,
      updated_at DESC, id DESC LIMIT 400)
)
  ORDER BY CASE WHEN kind='informacion' THEN 0 ELSE 1 END,
    CASE
    WHEN ends_at >= datetime('now') THEN 0
    WHEN starts_at >= datetime('now') THEN 1
    ELSE 2 END,
    updated_at DESC, id DESC
  LIMIT 400`;
