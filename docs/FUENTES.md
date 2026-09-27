# Fuentes públicas de DocenteTuc

Investigación técnica realizada el 25 de septiembre de 2026. Se inspeccionaron únicamente páginas, scripts y endpoints que los propios frontends oficiales exponen sin autenticación. No se probaron credenciales, CAPTCHA, áreas privadas ni mecanismos de postulación.

## 1. SIME — Vacantes

**FUENTE**  
SIME — Sistema Integrado del Ministerio de Educación de Tucumán.

**URL**  
Página pública: <https://sime.educaciontuc.gov.ar/Vacantes/Index>  
Detalle oficial: `https://sime.educaciontuc.gov.ar/Vacantes/Detalle/{id}`

**TIPO DE INFORMACIÓN**  
Pedidos públicos de cobertura de las cuatro Juntas: Inicial y Primaria (`id=1`), Secundaria (`id=2`), Técnica/Agrotécnica/No Formal (`id=3`) y Superior/Especial/Artística (`id=4`). Distingue interinatos, suplencias y comunicados; también identifica llamados abiertos.

**MÉTODO DE OBTENCIÓN**  
La página se renderiza en HTML y monta una interfaz Vue. El listado se carga desde endpoints JSON públicos del mismo dominio:

- `GET /Vacantes/ObtenerPeriodos/{junta}?caracter={-1|1|2|3}&tab={tab}`
- `GET /Vacantes/ObtenerVacantes/{junta}?caracter={...}&tab={...}&mesBuscar={MM}&anioBuscar={AAAA}`
- `GET /Vacantes/ObtenerVacante/{id}?origen=&postulante=`
- `GET /Vacantes/ObtenerDetalleVacante/{id}`
- `GET /Vacantes/ObtenerPadrones/{id}`
- `GET /Vacantes/ObtenerHorarios/{cargo_id}`
- `GET /Vacantes/ObtenerEstablecimientoDomicilio/{organismo_id}`

La V1 sincroniza períodos y listados. Conserva el enlace oficial y evita descargar todos los detalles en cada ciclo para no sobrecargar SIME.

**CAMPOS DISPONIBLES**  
En el listado: `id`, `codigo`, `caracter`, `fechaPublicacionInicio`, `fechaPublicacionFin`, `cargos`, `abierto`. El texto `cargos` contiene uno o más cargos con código de establecimiento, institución, cargo/materia, curso/división, turno e identificador de cargo.  
En el detalle: descripción, fecha de designación, estado, establecimiento, cargo, nivel, modalidad, materia, `cargos_id`, `organismo_id`; los endpoints auxiliares agregan horarios, domicilio/localidad/departamento y padrón/convocatoria.

**IDENTIFICADORES Y CAMBIOS**  
`id` es el identificador técnico estable y `codigo` el visible (`PDVC-...`). Una publicación es nueva si aparece un `id` desconocido. Una modificación se detecta con una huella SHA-256 de los campos públicos; para cambios de detalle se debe incluir también la respuesta de los endpoints de detalle.

**PAGINACIÓN Y FILTROS**  
No se observó paginación: el endpoint devuelve el arreglo completo para la combinación elegida. Los filtros nativos son Junta, carácter, pestaña y período mes/año. DocenteTuc aplica filtros por nivel, materia, turno, estado, coincidencia y guardados.

**LIMITACIONES**  
La localidad y el departamento no están de forma confiable en el listado; requieren consultar cada establecimiento. `cargos` es texto compuesto y puede incluir varios cargos. `abierto` identifica llamados abiertos, no la vigencia por fecha. Los contratos JSON no están documentados y podrían cambiar.

**ESTRATEGIA DE ACTUALIZACIÓN**  
Consultar períodos y listados cada 15 minutos durante días hábiles y cada 60 minutos fuera de horario. Respetar `429` y aplicar pausas progresivas. Guardar por `sime:{id}`, comparar huella y conservar la última respuesta válida. Consultar detalles bajo demanda o en una cola de baja frecuencia.

## 2. Padrones y Comunicados

**FUENTE**  
Comunicados y Padrones — Ministerio de Educación de Tucumán.

**URL**  
Índice oficial: <https://padrones.educaciontuc.gov.ar/>

**TIPO DE INFORMACIÓN**  
Comunicados, padrones, llamados abiertos y normativa de las cuatro Juntas. Incluye los decretos 2926/5 y 292/5.

**MÉTODO DE OBTENCIÓN**  
El índice es HTML estático generado con Nicepage. Enlaza cuatro Google Docs públicos para comunicados, carpetas públicas de Google Drive para padrones/llamados y PDF alojados en el dominio oficial.

Los Docs admiten exportación pública con `https://docs.google.com/document/d/{documentId}/export?format=html`. DocenteTuc sanea esa exportación y muestra el texto legible dentro de la aplicación, conservando siempre el original como fuente. Las carpetas públicas de Drive exponen sus elementos directos en la propia página pública: DocenteTuc indexa sus nombres y enlaces sin credenciales. Los Google Docs encontrados allí también pueden leerse; PDF y subcarpetas conservan el enlace oficial porque no existe un feed público estable ni un extractor PDF en el Worker.

**CAMPOS DISPONIBLES**  
Del índice: Junta, tipo, URL, `documentId` o `folderId`. En los Docs pueden aparecer títulos, fechas, tablas y enlaces, pero la estructura editorial es libre. Los PDF aportan URL y título visible; sus metadatos internos varían.

**IDENTIFICADORES Y CAMBIOS**  
El ID de Docs/Drive y la URL de PDF identifican cada contenedor. Los elementos públicos directos de una carpeta usan su ID de Drive. Una modificación se detecta por SHA-256 del contenido exportado o de los metadatos públicos visibles.

**PAGINACIÓN Y FILTROS**  
El índice no tiene paginación ni filtros programáticos. La separación por Junta y categoría está codificada en HTML. Drive maneja su propia navegación.

**LIMITACIONES**  
Los comunicados son documentos acumulativos grandes; no se observó `ETag` o `Last-Modified` útil. Drive es una interfaz dinámica, no un feed documentado, y puede cambiar. Extraer fechas desde contenido libre puede generar ambigüedad, por eso DocenteTuc conserva el texto y no inventa fechas ni estados. Si Drive deja de exponer el índice público, se mantiene la última copia válida.

**ESTRATEGIA DE ACTUALIZACIÓN**  
Revisar el índice cada 30 minutos. Calcular la huella de Docs cada 30–60 minutos, secuencialmente y con límites. Avisar `PADRON_ACTUALIZADO` sólo si cambia una publicación seguida. Para una V2, acordar un feed con el Ministerio o usar Drive API con autorización explícita.

## 3. Capacitación Docente (FDCI)

**FUENTE**  
Subdirección de Formación Docente Continua e Investigación.

**URL**  
Frontend: <https://capacitaciondocente.educaciontuc.gov.ar/>  
API usada por el frontend: <https://apicapacitaciones.educaciontuc.edu.ar/api>

**TIPO DE INFORMACIÓN**  
Oferta de capacitaciones, comisiones, preinscripciones, calendario, modalidad, nivel, eje prioritario, horas cátedra, institución, cronograma, cupos, lugar y fechas.

**MÉTODO DE OBTENCIÓN**  
El frontend es una SPA Vue; el HTML inicial sólo contiene `#app` y scripts versionados. Esos scripts consumen JSON público de otra API:

- `GET /capa/listado?nivel={nivel}`
- `GET /gestionCapas/getCapaActivas`
- `GET /gestionCapas/getRestoCapas`
- `GET /gestionCapas/getPendientesListado`
- `GET /gestionCapas/calendario`
- `GET /textos/home`, `/textos/banner`, `/textos/avisos`

El detalle usa `POST /capa/getCupo` con `token` y `slug`; inscripción y áreas autenticadas no forman parte del recolector.

**CAMPOS DISPONIBLES**  
Catálogo: `capacitacion_id`, nombre, modalidad, contenido, descripción/destinatarios, `horas_catedra`, `nombre_direccion`, imagen, `token`, niveles, eje prioritario, indicador de comisiones, próxima fecha y `slug`.  
Comisión: `id`, `capacitacion_id`, cronograma, inicio/fin, apertura/cierre de preinscripción, departamento, lugar, dirección, encuentros, cupos, estados, `created_at`, `updated_at`, institución, modalidad, imagen, token y slug.

**IDENTIFICADORES Y CAMBIOS**  
`capacitacion_id` identifica la capacitación; `id` una comisión. `token` + `slug` construyen la ruta. Un ID desconocido es nuevo. La huella de catálogo + comisión detecta cambios; `updated_at` es una señal adicional.

**PAGINACIÓN Y FILTROS**  
No se observó paginación. `/capa/listado` filtra por nivel; el frontend separa activas, próximas y pendientes.

**LIMITACIONES**  
`getRestoCapas` es grande y mezcla oferta histórica; la V1 usa `/capa/listado?nivel=TODOS` y lo cruza con comisiones activas. Descripción y cronograma contienen HTML. Cupo no equivale a disponibilidad instantánea. La inscripción oficial puede usar reCAPTCHA: DocenteTuc no lo replica ni automatiza.

**ESTRATEGIA DE ACTUALIZACIÓN**  
Consultar catálogo y comisiones cada 30 minutos; reducir a dos horas si no hay inscripciones abiertas. Guardar por `fdci:{capacitacion_id}`, sanear HTML a texto, comparar huella y preservar URL oficial. Respetar `429` y nunca enviar inscripciones.

## Política común

- DocenteTuc se identifica como agregador independiente y conserva `source` + `official_url`.
- La fuente oficial prevalece. Una coincidencia sólo significa “podría interesarte”.
- No se solicitan ni almacenan claves de SIME u otros sistemas.
- Los recolectores usan límites de frecuencia, deduplicación por ID y huella SHA-256.
- Ante un fallo se conserva la última sincronización válida; nunca se reemplaza con datos simulados.
