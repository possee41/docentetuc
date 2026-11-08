# Corrección ejecutable de la publicación de sincronización

Base de esta rama: `7d550d16f427a55e7e0cac2a461ea7fb1de3e49d`. Dependencias recuperadas exclusivamente del árbol aprobado `358112c5cb96ec322e870d0b80cf4d4747027691`. Inventario y hashes exactos: `docs/sync-publication-dependencies.json`.

Se añadieron 27 módulos ausentes (colectores, normalizadores, receivers y sus imports transitivos), seis versiones compatibles de módulos compartidos y los SQL 0021/0022 usados por las pruebas SQLite. Los SQL se recuperaron como archivos existentes aprobados, no se aplicaron a D1. Los imports FDCI heredados son dependencias estáticas de módulos reutilizados, no autorización para ejecutarlos; las rutas FDCI siguen rechazadas por el entrypoint de ensayo. No se reemplazó db/schema.ts, la interfaz, autenticación o el paquete Web. Esta rama es un paquete de sincronización: **no desplegar la web completa desde ella**. El checkout integrado Web 1.2 sigue separado, sin modificaciones.

## Prueba aislada

- `wrangler.1.2-daily-sources.jsonc` ahora nombra `docentetuc-sources-canary-1-2`. D1 es `docentetuc-sources-canary-1-2-local`, UUID cero reservado y `remote:false`: configuración local, no desplegable como D1 remota válida. No contiene UUID ni nombre productivo. Sin rutas, workers.dev, previews o Cron; flags deshabilitados.
- El receptor rechaza el UUID productivo antes de consultar DB y exige el marcador de entorno Canary. El runner diario rechaza target=production y otras identidades de base/host. Noticias solo admite el origen canary.docentetuc.com.ar, incluso si se entrega una bandera de aprobación productiva.
- Se retiró `redact_query_string` del JSON de Wrangler porque 4.92.0 no admite ese campo allí. No se efectuó ningún PATCH remoto. Los runners no ponen secretos ni datos personales en query strings.
- Workflows limitados a workflow_dispatch en `release/daily-sync-358112c`; no aceptan schedule para esta etapa aunque alguien quite un comentario por error. Se distinguen DAILY_VALIDATION_ENABLED (solo validación) de DAILY_CANARY_TEST_ENABLED/NEWS_CANARY_TEST_ENABLED (prueba funcional posterior). Ninguna variable remota fue creada o activada.
- El job validation_only usa contents:read, sin secretos, Git token explícito ni entorno de sincronización. Solo importa/verifica el paquete y ejecuta las pruebas locales existentes y los controles nuevos de aislamiento. No necesita Worker ni D1 remota, estado Git, credenciales de importación o consultas oficiales. Los jobs de sincronización funcional permanecen cerrados y conservan revisión de SHA y concesiones.

## Evidencia local

Desde una exportación limpia del commit de publicación, antes de incorporar dependencias, las pruebas de Noticias fallaban por SQL ausente. Con los archivos recuperados: **21/21 comprobaciones focalizadas** aprobadas. Se ejecutaron los handlers de Noticias con SQLite en memoria, reanudación entre procesos, cierre/propietario y los nuevos rechazos de producción; no se repitió la suite general ni las 74 pruebas anteriores.

`node --experimental-strip-types scripts/verify-sync-publication.mjs` importa los tres entrypoints reales, verifica la clausura de **45 módulos**, sin imports faltantes, con fetch prohibido durante la carga y sin paquetes npm de runtime. Verifica 35 hashes recuperados y hashes de los archivos Web que no deben cambiar. Permite ejecutar la comprobación en un runner Node 24 limpio sin instalar dependencias. El dry-run local de Wrangler compila el receptor; no publica código ni consulta D1.

## Registro manual pendiente, sin modificar la rama predeterminada ahora

GitHub exige que el archivo del workflow exista en la rama predeterminada para recibir workflow_dispatch: [documentación oficial](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_dispatch). Publicar solo una rama release no lo registra. No se utiliza un workflow antiguo para eludir esta condición.

Se preparó `docs/examples/register-daily-validation.yml.example`: registro mínimo sin checkout, secretos, schedule ni escrituras. Con autorización posterior, su ruta en la rama predeterminada será `.github/workflows/daily-public-sources.yml`, idéntica a la ruta del workflow de la rama release. El registro en default solo muestra instrucciones; el dispatch con ref=release usa el código de release. No es necesario fusionar toda esta rama ni tocar el código Web para registrar la validación. Para ejecutar Noticias de forma independiente en el futuro habrá que registrar también su workflow; eso no forma parte de la primera corrida.

Operaciones pendientes (NO ejecutadas):

1. Verificar que la rama remota continúa en 7d550d1 y autorizar push del commit corregido, sin force, exclusivamente a `release/daily-sync-358112c`.
2. Autorizar por separado el registro mínimo anterior en la rama predeterminada, respetando PR/protecciones. No cambiar la rama predeterminada, fusionar la rama release completa ni desplegar código.
3. Fijar DAILY_APPROVED_SHA al SHA completo corregido y autorizar exclusivamente DAILY_VALIDATION_ENABLED=true. Conservar DAILY_CANARY_TEST_ENABLED=false, NEWS_CANARY_TEST_ENABLED=false y todas las automatizaciones deshabilitadas.
4. Autorizar una única llamada POST `/repos/possee41/docentetuc/actions/workflows/daily-public-sources.yml/dispatches` con `{"ref":"release/daily-sync-358112c","inputs":{"source":"sime","validation_only":true}}`. La corrida solo valida localmente el paquete. SHA del evento, checkout y aprobación deben coincidir.

La primera sincronización real es otra operación: requiere Worker y D1 Canary exclusivos verificados, UUID real aprobado, esquema, credenciales y permiso de escritura temporal. No se sustituyen por valores inventados ni se apunta a producción para superar el bloqueo. No se crearon esos recursos, credenciales o estados en esta corrección.
