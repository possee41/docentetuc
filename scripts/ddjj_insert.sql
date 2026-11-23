-- Insercion idempotente del formulario DDJJ en Informacion util
-- Ejecutar con: npx wrangler d1 execute docentetuc-db --remote --file scripts/ddjj_insert.sql --config wrangler.1.2-web-production.jsonc
INSERT OR IGNORE INTO publications
(id, source, external_id, kind, category, title, summary, status, official_url, content_hash, metadata, normalized_status, source_status)
VALUES
('info:ddjj-cargos-actividades', 'Informacion oficial Tucuman', 'ddjj-cargos-actividades', 'informacion', 'Tramites',
 'Declaracion Jurada de Cargos y Actividades (DDJJ)',
 'Formulario en blanco para declarar cargos, funciones, horas catedra y horarios de trabajo docente. Documento PDF de dos paginas para completar manualmente.',
 'consultar fuente',
 'https://docentetuc.com.ar/documents/Nueva_DDJJ_2026_en_blanco.pdf',
 'local-reference:ddjj-cargos-actividades',
 '{"recordType":"procedure","documents":["Formulario DDJJ en blanco (PDF)"],"aliases":["declaracion jurada","DDJJ","cargos y actividades","formulario DDJJ","declarar cargos"],"lastVerified":"2026-09-27","notes":"Documento disponible para descarga. El docente debe completarlo y presentarlo segun las indicaciones del Ministerio de Educacion."}',
 'UNKNOWN', 'sin verificar');