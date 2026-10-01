# Google Play — información gubernamental y fuentes

**Texto de independencia para la ficha:** «DocenteTuc es una aplicación independiente y no representa al Gobierno de Tucumán, al Ministerio de Educación de Tucumán ni a ningún organismo público.» La app organiza información y conserva enlaces a las fuentes originales; no realiza trámites oficiales en nombre del usuario ni garantiza cobertura completa o actualización instantánea. El diseño y la ficha no deben usar emblemas oficiales para sugerir afiliación.

## Fuentes recuperadas por el sincronizador actual

| Fuente / URL original | Información utilizada | Mecanismo real y límite |
| --- | --- | --- |
| [SIME — Vacantes](https://sime.educaciontuc.gov.ar/Vacantes/Index) | Períodos, vacantes/designaciones, cargos, junta, carácter y fechas publicadas; enlaces a cada detalle. | `/api/sync` consulta endpoints JSON públicos `ObtenerPeriodos` y `ObtenerVacantes` para cuatro juntas. Los resultados dependen de la disponibilidad/formato de SIME; la inscripción o postulación ocurre fuera de DocenteTuc. |
| [Capacitación Docente FDCI](https://capacitaciondocente.educaciontuc.gov.ar/) y [API pública](https://apicapacitaciones.educaciontuc.edu.ar/api) | Cursos, comisiones, cupos y fechas de preinscripción publicadas. | `/api/sync` consulta catálogos/activas y detalle de comisión. La apertura de inscripción FDCI se basa en **Inicio de Preinscripción y hora** cuando están publicados, no en el inicio del curso. No gestiona la cuenta FDCI. |
| [CeNET / INET](https://cenet.inet.edu.ar/mod/page/view.php?id=30493) | Capacitaciones presentes en la página pública. | Descarga HTML y extrae datos reconocibles; cambios de formato o falta de fechas limitan los resultados. |
| [INFoD — cursos nacionales](https://red.infd.edu.ar/cursos-nacionales-2/) | Cursos y páginas públicas enlazadas desde el catálogo. | Descarga HTML del catálogo y páginas recuperables; no accede al área privada de AulaS-TIC. Los datos disponibles dependen de cada página. |
| [Padrones, comunicados y llamados del sitio de Juntas](https://padrones.educaciontuc.gov.ar/) | Cuatro documentos públicos de comunicados, cuatro carpetas de padrones, dos raíces de llamados y dos resoluciones enlazadas. | `/api/sync` recupera documentos públicos de Google Docs/Drive o PDF mediante URLs específicas de las Juntas. El barrido de carpetas es incremental y **no debe presentarse como exhaustivo** mientras no exista una instantánea completa sin errores. Algunos documentos sólo ofrecen enlace/metadata. |

`app/api/sync/route.ts` contiene las URLs de origen y la normalización; `lib/public-documents.ts` y `lib/board-crawl.ts` procesan los documentos de Juntas. La existencia de un enlace no significa que se haya indexado todo su contenido. La ficha debe remitir a estas fuentes visibles para que las personas verifiquen vigencia y exactitud. Aplicar la [política de información gubernamental de Google Play](https://support.google.com/googleplay/android-developer/answer/9514050?hl=es).

## Información útil: enlaces curados, no integración de datos personales

`lib/useful-information.ts` mantiene fichas/enlaces de organismos y trámites, entre ellos [Ministerio de Educación de Tucumán](https://www.educaciontuc.gov.ar/a/ministerio/), [Guía de Trámites SIME](https://sime.educaciontuc.gov.ar/GuiaTramites/), [consulta de expedientes](https://sime.educaciontuc.gov.ar/ConsultaExpediente/Index), [Juntas](https://task.educaciontuc.gov.ar/), [Departamento de Títulos](https://www.educaciontuc.gov.ar/departamento-de-titulos/index.html) y [FDCI](https://capacitaciondocente.educaciontuc.gov.ar/). Son referencias informativas mantenidas en el repositorio, no una conexión a cuentas privadas ni una garantía de actualización automática de cada teléfono, requisito u horario.

## Texto breve utilizable en Play

«DocenteTuc reúne publicaciones públicas para docentes de Tucumán y enlaza las fuentes originales de SIME, FDCI, CeNET/INET, INFoD y las Juntas de Clasificación. La disponibilidad y vigencia dependen de cada organismo. DocenteTuc es una aplicación independiente y no representa al Gobierno de Tucumán, al Ministerio de Educación de Tucumán ni a ningún organismo público.»
