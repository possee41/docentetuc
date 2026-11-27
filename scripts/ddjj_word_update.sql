-- Actualizacion idempotente: agrega wordUrl al metadata de la DDJJ
-- Ejecutar con: npx wrangler d1 execute docentetuc-db --remote --file scripts/ddjj_word_update.sql --config wrangler.1.2-web-production.jsonc
UPDATE publications
SET metadata = '{"recordType":"procedure","documents":["Formulario DDJJ en blanco (PDF)","Formulario DDJJ en blanco (Word)"],"aliases":["declaracion jurada","DDJJ","cargos y actividades","formulario DDJJ","declarar cargos"],"lastVerified":"2026-09-27","wordUrl":"https://docentetuc.com.ar/documents/Nueva_DDJJ_2026_en_blanco.docx","notes":"Documento disponible para descarga en PDF y Word. El docente debe completarlo y presentarlo segun las indicaciones del Ministerio de Educacion."}'
WHERE id = 'info:ddjj-cargos-actividades';