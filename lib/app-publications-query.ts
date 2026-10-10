export const APP_PUBLICATIONS_QUERY = `SELECT * FROM publications
  WHERE kind='informacion' OR id IN (
    SELECT id FROM publications WHERE kind<>'informacion'
    ORDER BY CASE WHEN json_valid(metadata) THEN
      CASE WHEN json_extract(metadata,'$.official.entity')='event'
        AND json_extract(metadata,'$.official.facts.designation.value') >= date('now','-3 hours') THEN 0
      WHEN json_extract(metadata,'$.official.canonicalId') IS NOT NULL THEN 2 ELSE 1 END ELSE 1 END,
      COALESCE(ends_at, starts_at, updated_at) DESC LIMIT 1500
  )
  ORDER BY COALESCE(ends_at, starts_at, updated_at) DESC`;
