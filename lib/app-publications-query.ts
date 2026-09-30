export const APP_PUBLICATIONS_QUERY = `SELECT * FROM publications
  WHERE kind='informacion' OR id IN (
    SELECT id FROM publications WHERE kind<>'informacion'
    ORDER BY COALESCE(ends_at, starts_at, updated_at) DESC LIMIT 1500
  )
  ORDER BY COALESCE(ends_at, starts_at, updated_at) DESC`;
