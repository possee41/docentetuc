# DocenteTuc 1.0 — informe de congelamiento

Fecha de corte: 1 de octubre de 2026. URL revisada: <https://docentetuc.possee41.workers.dev/>. Versión Android declarada en el proyecto: `1.0.9` (`versionCode` 10). Este documento congela el alcance y registra límites conocidos; no certifica exhaustividad de las fuentes ni aprobación para Google Play.

## Decisión

**Congelamiento funcional del alcance 1.0: SÍ, con limitaciones explícitas.** No significa que cada integración externa sea exhaustiva ni que la versión Android esté lista para tienda. **AAB final/Google Play: NO listo.** Antes de una entrega Android definitiva siguen pendientes una nueva verificación y compilación controlada, prueba física del APK de esa misma versión y capturas de tienda auténticas. No compilar APK/AAB ni incrementar `versionCode` como parte de este cierre.

## Alcance y estado observable

Los estados describen evidencia de código, datos persistidos y pruebas disponibles; no sustituyen una prueba física integral.

| Área | Estado | Qué está comprobado / límite conocido |
| --- | --- | --- |
| Inicio y seis accesos | PARCIAL | Interfaz y datos provienen del proyecto actual; no se volvió a hacer recorrido visual de todos los tamaños ni una prueba física de la versión Android actual. |
| Perfil docente | PARCIAL | Perfil y preferencias se guardan por identidad de instalación en D1; no hay cuenta propia con contraseña ni recuperación automática entre dispositivos. Un recorrido con perfil real no se ejecutó en este cierre. |
| Designaciones / SIME | PARCIAL | El Worker sincroniza endpoints JSON públicos y conserva el enlace a SIME; la disponibilidad y campos dependen de esa fuente. No afirmar que reemplaza postulación oficial ni que la cobertura sea total. |
| Matching personal | PARCIAL | Se usa el perfil existente, con evidencia/confianza y campos desconocidos; pruebas automatizadas cubren la lógica. No se certificó elegibilidad oficial ni se hizo una prueba física con todos los perfiles/circuitos. |
| Capacitaciones | PARCIAL | A la última lectura D1: FDCI 240 filas publicadas (el contador de la sincronización dice 236; diferencia no reconciliada), CeNET/INET 42 e INFoD 39. La presencia en la app no implica que todas publiquen apertura de inscripción. |
| FDCI | PARCIAL | La lógica lee inicio de preinscripción de comisión y no usa inicio del curso como apertura. No se encontró próxima apertura confirmada en los registros revisados. Hay una inconsistencia de origen en una comisión: `status`/`normalized_status` dicen inscripción cerrada, aunque el intervalo de fechas almacenado todavía alcanzaba la mañana del 1/10; la app/IA respetan el estado cerrado, sin corregir ni inventar datos. |
| CeNET / INET | PARCIAL | Adaptador público recupera 42 capacitaciones. Las aperturas próximas observadas (5–12 de octubre de 2026) son tentativas y no traen hora exacta; no presentarlas como confirmadas. |
| INFoD / AulaS-TIC | PARCIAL | Adaptador recupera 39 registros públicos. En el corte no había fechas futuras de inscripción en los registros; no accede a zonas privadas. |
| Padrones | PARCIAL | Barrido incremental D1. De seis raíces Padrones/Llamados, sólo `pad-secundaria` tenía instantánea completa (562 elementos); las otras cinco seguían en curso, sin errores terminales en la última lectura. No llamarlo exhaustivo. |
| Comunicados | VERIFICADO (contenido recuperable) | Cuatro comunicados persistidos; los resúmenes conservan entre 39.997 y 40.000 caracteres y mantienen URL oficial. El campo estructurado `metadata.content` estaba vacío en las cuatro filas; el resumen es el contenido recuperable. |
| Llamados abiertos | PARCIAL | Dos raíces en barrido incremental; ambas seguían incompletas en el último estado D1. |
| Agenda | PARCIAL | El proyecto contempla eventos manuales, eventos vinculados y recordatorios persistidos; esta fase no hizo un recorrido físico de creación, edición y entrega del recordatorio. |
| Guardados y seguimiento | PARCIAL | Persistencia por identidad de instalación en D1 y funciones implementadas; no se migran automáticamente entre instalaciones. |
| Alertas y Push | PARCIAL | Cron configurado cada cinco minutos; el handler despacha push en cada tick y ejecuta sincronización de fuentes en el minuto UTC `:00` (cada hora). Ejecuciones automáticas y estado de sincronización constan en D1; recepción/apertura de push en el APK actual no se verificó físicamente. |
| Información útil | PARCIAL | Fichas curadas desde `lib/useful-information.ts`; no son integración autenticada con organismos ni garantía de vigencia automática. No se certificó en este cierre cada teléfono/enlace ni todo el recorrido visual. |
| DocenteTuc IA | PARCIAL | La ruta de chat recupera publicaciones con `APP_PUBLICATIONS_QUERY`, la misma consulta de `/api/app`; el contexto separa aperturas confirmadas, tentativas y fechas desconocidas. Hay tests para consultas de próximas fechas, semana, abiertas, FDCI, CeNET y personalización. La variable pública del Worker declara Gemini; no se hizo una prueba conversacional en vivo de cada pregunta en este cierre, y la clave secreta no se inspeccionó. |
| Política y eliminación | VERIFICADO (páginas públicas) | `/privacidad` y `/eliminar-datos` respondieron HTTP 200 sin credenciales en comprobación previa. La eliminación de D1 es asistida, requiere verificación humana y no borra cuentas/datos alojados en fuentes externas. |
| Data Safety | PARCIAL | Inventario basado en código en `docs/google-play-data-safety.md`; faltan confirmar retención/subprocesadores de Cloudflare, Gemini, Open-Meteo, servicios push, logs y clasificación final de Play Console. |
| PWA / Android | PARCIAL | Configuración y recursos están en el repositorio. No se verificó en este cierre la instalación ni el icono del APK actual en teléfono. Un APK previo no sustituye la prueba del artefacto final. |

## IA y fuente común de capacitaciones

La API de chat toma filas de `publications` usando `APP_PUBLICATIONS_QUERY`, que también usa `/api/app`, y luego aplica recuperación por intención, fuente, estado de inscripción y metadata temporal. Esto elimina la consulta paralela que antes leía una ventana arbitraria de publicaciones recientes. FDCI se basa en apertura de preinscripción de la comisión, no en comienzo del curso; fechas tentativas se etiquetan como previstas. Los tests comprueban el contexto y la selección de fuentes, no garantizan por sí solos una respuesta idéntica del proveedor generativo.

Último estado D1 revisado en este cierre (1 de octubre, 04:00:05 UTC): SIME 161, FDCI 236 en estado de sincronización, CeNET 42, INFoD 39, Comunicados 4, Información útil 18 y Resoluciones 2 con `sync_status=OK` y sin error. En la tabla de publicaciones, FDCI contaba 240 filas; esa diferencia de cuatro no se explicó y queda abierta. Padrones (1.333 filas) y Llamados (445) estaban `PARTIAL`, sin éxito completo reciente. El cron está definido como `*/5 * * * *`; cada tick procesa push y sólo el tick en minuto UTC cero ejecuta `/api/sync`. Por eso, una última sincronización de fuentes a las 04:00 UTC es coherente con la configuración de sincronización horaria, no evidencia de que ésta corra cada cinco minutos.

## Privacidad, tienda e identidad

- La aplicación no crea cuentas propias con contraseña; el identificador técnico principal es UUID por instalación. No prometer sincronización/recuperación de perfil entre dispositivos.
- Las credenciales de SIME/FDCI y otras plataformas no se solicitan. Las inscripciones se completan en sus sitios oficiales.
- Gemini recibe consulta y contexto pertinente al usar IA; la conversación no se persiste como historial en D1. Si el usuario autoriza perfil, pueden enviarse campos pertinentes. Verificar política/retención del proveedor antes de completar Data Safety.
- La solicitud de eliminación se tramita por soporte con verificación de titularidad y borrado administrativo; no existe un endpoint público que borre instantáneamente y sin verificación.
- Mantener en ficha el lema **“De un docente, para todos los docentes.”** y la aclaración de que DocenteTuc es independiente y no representa al Gobierno de Tucumán, su Ministerio de Educación ni otro organismo público.
- Los ocho WebP de interfaz existen y están referenciados por sección en `app/globals.css`: `home-hero`, `designaciones-hero`, `capacitaciones-hero`, `padrones-hero`, `agenda-hero`, `novedades-hero`, `informacion-util-hero` e `ia-hero`. Son arte del producto, no las capturas ni el feature graphic de Play.
- El estado de icono, feature graphic y capturas está documentado en `docs/google-play-assets.md`. El icono de ficha sólo es un candidato; el feature graphic encontrado es un montaje con interfaz ficticia. Aunque el usuario informa que tomó capturas con un teléfono real, los originales no se encontraron entre los archivos disponibles para validar versión, resolución y contenido. No subir los mockups como capturas reales.

## Control de cierre

- Producción: `/`, `/privacidad` y `/eliminar-datos` respondieron HTTP 200 sin credenciales durante este cierre. `wrangler deployments list` confirmó como versión activa (100%) `322c892e-e9a8-4a71-ab90-bad5e304256f`. El nombre secreto `AI_API_KEY` figura en la lista del Worker, sin leer su valor; `AI_PROVIDER=gemini` y el modelo están declarados. No se envió una consulta de producción a Gemini en esta auditoría. La ruta `/api/app` es por identidad de instalación y no se usa como health check anónimo.
- Tests/lint/build/Git: en este cierre, 138/138 tests, lint sin errores, build web correcto y `git diff --check` correcto. No se ejecutó build Android.
- Android: no compilar durante esta fase. `versionName` 1.0.9 / `versionCode` 10 en configuración actual. Antes de un AAB final, confirmar en Play Console el mayor código usado, conservar el keystore existente, generar una sola compilación de release y probar físicamente el APK firmado correspondiente sin desinstalar la app previa.

## Reconciliación FDCI (consulta de solo lectura, 1 de octubre de 2026)

- D1 contenía 240 publicaciones con `source='Capacitación Docente'`; `sync_state.item_count=236` corresponde al último lote normalizado satisfactorio (`OK`, 1 de octubre de 2026 05:00:05 UTC), no al total histórico de filas retenidas en D1.
- La consulta del catálogo público y la misma normalización de cursos/comisiones devolvió 236 IDs únicos. Las cuatro filas adicionales de D1 son: `fdci:course:2865` y `fdci:course:2996`, que figuran `REMOVED_FROM_SOURCE` porque el lote actual las representa a nivel de comisión (los cursos siguen en el catálogo, actualmente como comisiones 6294 y 6186); más `fdci:commission:6161` y `fdci:commission:6197`, comisiones cerradas de septiembre retenidas como historial y ausentes del snapshot actual. Son representaciones antiguas e historial, no cuatro oportunidades activas perdidas ni comisiones duplicadas. No se borró ni modificó ninguna fila.
- `last_seen_at` no basta para probar pertenencia de una fila individual al lote: el sincronizador puede actualizar esa marca para filas de una fuente cuando la fuente completa sincroniza correctamente. Para esta comparación se usaron IDs del lote público normalizado y `sync_state`, no esa marca como única prueba.
- RCP, curso 2996 / comisión 6186: la fuente aún informa cierre de preinscripción `2026-10-01 08:00` hora Argentina, pero también `isActivePre=0`, `isActiveComision=0`, `cupo_disponible_pre=0` y `comision_cerrada=0`; el catálogo informa `hasActiveComision=0`. El cierre mostrado coincide con la bandera oficial de preinscripción inactiva, no con un desfase horario ni con la mera comparación de la fecha futura. La fuente no expone un motivo definitivo (por ejemplo, si la desactivación fue manual); no atribuirlo con certeza a cupos agotados. La lógica de DocenteTuc conserva el estado de fuente y prioriza `isActivePre`; no se cambió.
- Play: no publicado. No completar la declaración Data Safety hasta cerrar sus pendientes con información de proveedores y artefacto definitivo.

## Fuera de alcance de 1.0 / reservar para 1.1

Comunidad y chat entre docentes, nuevas fuentes, nuevos formularios y funciones experimentales; cobertura exhaustiva prometida de Padrones/Llamados; personalización entre dispositivos/cuentas propias; automatización de trámites externos; nuevas funciones de IA; y cualquier rediseño o cambio no requerido para corregir defectos críticos.

## Veredicto

Puede congelarse el **alcance funcional** de 1.0 con los límites de esta auditoría visibles. No puede presentarse como cobertura exhaustiva de todas las fuentes, como prueba Android final superada ni como paquete listo/publicado en Google Play. Antes de tienda hacen falta completar/reevaluar el barrido incremental, disponer de feature graphic y capturas reales verificables, cerrar Data Safety y probar el release firmado en el teléfono.
