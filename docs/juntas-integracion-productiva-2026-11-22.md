# Padrones y Comunicados — integración productiva preparada, 22/11/2026

**Dictamen: preparado para autorizar la integración controlada. No se desplegó, migró, importó ni activó nada remotamente.** El commit final se registra en el manifiesto que genera `scripts/prepare-juntas-production.mjs` después del commit local. El runtime aprobado deberá fijarse a ese SHA completo; no usar el SHA de Canary para ejecutar el nuevo adaptador productivo.

## Base productiva y alcance selectivo

- Worker vigente comprobado por metadata: `docentetuc`, versión **e7d07d08-fc47-41a2-b714-61263282961b**, deployment **f5541fb6-48f3-4d92-ae5f-c80df755a099**, **100 %**. También es la referencia de rollback, a releer antes de cualquier escritura futura.
- El log local de Wrangler del 21/11 18:21 UTC vincula ese upload con los módulos del artefacto original en `DocenteTuc-1.2-sync-integration/dist`. Ese checkout tiene código funcional limpio en **2d32f22e888e296948f70711efd86692691cabe9**; sólo había documentación/migración 0099 sin seguimiento, que no se incorporaron. Se creó el worktree exclusivo `DocenteTuc-juntas-production`, rama `local/juntas-production-20261121`, desde esa base.
- La reconstrucción de la base cambia BUILD_ID, nombres derivados y aliases de importación; no se declara reproducción binaria idéntica. Los módulos de Administración y Comunidad normalizados por referencias de chunks coinciden. La preparación registra hashes del artefacto nuevo y exige volver a comprobar la versión viva antes de publicar tráfico.
- Se extrajo código Juntas desde **932f8445053cd25b1fd07856bfd8e16a4151ccc4**, sin fusionar la rama entera: clasificación, consultas, paginación de 50, revisiones, UI, checkpoint, transporte y políticas diferenciadas.
- Se preservó específicamente **Llamados**: mismo SQL y parámetros productivos para 20 combinaciones de filtros/modos; su handler original continúa atendiendo esa vista. Los cambios de deduplicación y visibilidad del componente compartido se aplican únicamente a Comunicados. `board-view.ts` permanece intacto.
- Inicio, consultas globales, autenticación, filtros SIME, FDCI, Noticias, IA, Comunidad y funciones personales de la aplicación conservan el código productivo. La prueba compara los archivos críticos y todo el cuerpo de `docente-app.tsx` desde Dashboard en adelante. No se incorporaron `use-training-catalog.ts`, las correcciones pendientes de Actos ni otros módulos de ramas paralelas.
- `fdci-canary-synthetic.ts` es una dependencia pequeña de la regla de visibilidad aprobada para estos lectores; contiene exclusivamente los cinco IDs conocidos. No habilita ni cambia un lector/recolector FDCI.
- Los flags actuales LEGACY_SYNC_PAUSED=true, AI_WEB_SEARCH_ENABLED=0 y PUSH_DISPATCH_MODE=disabled coinciden con la configuración base. El paquete de upload elimina incluso esas variables del payload y usa keep_vars=true: hereda las existentes, sin sustituir secretos o parámetros de otros módulos.

## Compatibilidad D1 y migración realmente necesaria

Identidad comprobada mediante SELECT: **docentetuc-db**, UUID **baaf5886-0123-4948-96da-aa7106424549**. Publicaciones tiene las **35 columnas** requeridas. Ya existen `juntas_import_checkpoint`, `juntas_import_applied`, `import_gate_lease` e `import_gateway_identity`; la identidad de su fila coincide. No se requiere otra D1 ni una migración de checkpoints.

**Falta realmente el historial 0100**: tabla `juntas_document_revisions`, tres triggers y los dos índices específicos de revisiones/orden cronológico de avisos. Se conserva el SQL ya aprobado y probado en Canary en `migrations/0100_juntas_document_revisions.sql`. No se modifican ni revierten los índices 0099.

La propuesta es ejecutar exclusivamente ese archivo, previa autorización, inventario compatible y recuperación disponible. **No ejecutar `d1 migrations apply` sobre el directorio completo:** podría aplicar migraciones ajenas pendientes. Registrar la aplicación conforme al control de migraciones del proyecto, sin inventar un estado previo.

La instalación es aditiva e idempotente, no cambia filas existentes ni hace un backfill masivo. Antes de cambiar un hash Juntas, el trigger guarda íntegramente la versión anterior y luego la nueva; el mismo hash no crea otra revisión. Se probó con un resumen legado de **40.000 caracteres**: el historial conserva todos los caracteres. Los triggers sólo actúan sobre publicaciones Juntas; no acceden a sesiones ni tablas personales. Producción ya tiene dos triggers de eventos externos. Se comprobó por SELECT que Juntas no está habilitada en external_event_sources (0 filas); no se cambia esa política. La prueba local de coexistencia conserva los eventos SIME y no genera eventos Juntas. Esta condición debe releerse antes de importar: si cambia, detenerse, sin modificar notificaciones por cuenta propia.

## Código publicado no equivale a documentos recuperados

Inventario productivo observado, sin leer información personal:

| Junta | Registros Padrones existentes | Referencias Comunicados existentes |
|---|---:|---:|
| Inicial y Primaria |844|1|
| Secundaria |695|1|
| Técnica, Agrotécnica y No Formal |815|1|
| Superior, Especial y Artística |1.100|1|
| **Total** |**3.454**|**4**|

No hay filas de checkpoints Juntas ni firmas aplicadas productivas. No se reinician ni se copian checkpoints de Canary: los futuros checkpoints productivos se inicializan de forma independiente sólo porque actualmente no existen. Antes de ejecutar debe releerse ese estado; si ya avanzó, se conserva el progreso nuevo.

Los metadatos legados todavía no contienen la etiqueta estructurada padronYear=2026. Eso **no prueba ausencia oficial** ni convierte todos los documentos en históricos. Una consulta dirigida no encontró coincidencias por ID ni URL exactos para los **14 PDF definitivos verificados en Canary**: seis generales de Secundaria, cinco generales de Técnica y tres de concursos específicos. Estos tres no deben presentarse como padrones generales. No se investigaron nuevamente las fuentes ni se afirma cobertura definitiva 2026 para Inicial/Primaria o Superior sin evidencia.

Los registros legados tienen metadatos medios de 77–82 caracteres, pero algunos resúmenes de Secundaria/Superior alcanzan 40.000 caracteres. Se conserva esa información y se monitorizará el tamaño real de páginas/revisiones; el corpus productivo es mayor que el Canary.

El despliegue web por sí solo no crea los PDF ni transforma los cuatro documentos raíz en avisos individuales. Puede mostrar los datos ya almacenados, referencias e incompletitud; la recuperación oficial requiere una autorización de importación separada.

## Recuperación y automatización preparadas, todavía inertes

El receptor existente `docentetuc-sources-1-2` pertenece a SIME/INFoD/CeNET y su wrapper no admite Juntas. No se lo modifica. Tampoco se toca el gateway FDCI retirado. Se propone un **Worker independiente `docentetuc-juntas-1-2`**, sin crear otra D1, que reutiliza autenticación, identidad, concesiones y las operaciones cerradas del gateway existente. **No se creó el Worker**: nombre disponible y cupo gratuito son comprobaciones obligatorias antes de autorizar su creación.

`wrangler.juntas-production.jsonc` está preparado con workers_dev=false, sin rutas, sin Cron, JUNTAS_PRODUCTION_ENABLED=false y sin credenciales ficticias. Sólo admite identidad Juntas, concesión, checkpoint y publicación Juntas; rechaza rutas SIME, FDCI, CeNET, INFoD y Noticias. La eliminación de autenticación redundante se limita al despacho Juntas ya autenticado/autorizado. La entrada pública del receptor común sigue autenticando como antes.

Para una primera recuperación supervisada:

1. Releer versión, identidad, esquema, concesiones y `docs/juntas-preflight-productivo-solo-lectura.sql`; comprobar cuotas disponibles y que no haya otro importador usando el lease compartido.
2. Registrar un bookmark de recuperación D1/alternativa verificada antes de la DDL. No exportar tablas personales ni restaurar toda la D1 como mecanismo de rollback rutinario.
3. Aplicar sólo 0100, crear/desplegar cerrado el receptor independiente y configurar una credencial Juntas dedicada, coincidente con un Environment GitHub propio. No reutilizar credenciales SIME/FDCI. Configurar una clave Drive autorizada para este ejecutor, sin publicarla.
4. Preparar Environment `juntas-production`, sin bypass administrativo y restringido sólo a la rama predeterminada. El workflow tiene un preflight previo **sin Environment** que consulta su existencia y política. Si falta, devuelve 403 o no puede verificarla, se detiene antes del job y no crea un Environment implícitamente. La efectividad de GITHUB_TOKEN aún no fue comprobada remotamente; no se ampliarán permisos automáticamente.
5. Publicar el runtime completo en una rama release identificable. Registrar únicamente `.github/workflows/juntas-maintenance-production.yml` en la rama predeterminada, manteniendo su schedule comentado. El preflight fija el SHA mediante output y el job protegido hace checkout de ese valor exacto: variables de Environment no pueden cambiar el runtime aprobado después del preflight.
6. Autorizar una única corrida manual: **máximo 25 HTTP oficiales reales y 20 intentos de publicación**, exclusivamente cuatro raíces Padrones y siete documentos Comunicados. Llamados no se incluye. Priorizar los recorridos actuales/2026 y reanudar el estado propio; no insertar manualmente los 14 documentos ni copiarlos desde Canary. No garantizar que todos quepan en el primer lote.
7. El runner registra ACK y avance mediante los checkpoints existentes, conserva PARTIAL, no borra ausencias y cierra la concesión aun si falla. TTL máximo 600 segundos, margen de cierre 30 segundos, sin reintentos de importación. El workflow agrega un cierre independiente idempotente; un fallo/cancelación previo bloquea la siguiente corrida programada hasta revisión y reconocimiento manual del run-ID exacto.
8. Comparar altas/actualizaciones/IDs/hashes, revisiones, cursores y visibilidad. Medir CPU nativa y D1 en las primeras operaciones autorizadas; no convertir las mediciones locales en CPU Cloudflare. Si hay respuesta ambigua, CPU incompatible, fallo de identidad/cuota o cierre, detener sin otro lote.

El cierre independiente está preparado mediante `node --experimental-strip-types scripts/juntas-production.mjs --close`, desde el runtime fijado y con sus variables/credencial segura y el mismo JUNTAS_RUN_OWNER=`juntas-<run-ID>`. No requiere que la habilitación siga activa ni necesita la clave Drive. No revocar la credencial hasta confirmar el cierre. Un hard cancel puede impedir ejecutar always(); la concesión expira y este procedimiento permite cerrar fuera de GitHub.

### Configuración diaria propuesta

- Schedule **comentado**, `7 11 * * *`: 08:07 Tucumán, sujeto a las demoras habituales de GitHub Actions.
- Flags de repositorio futuros, inicialmente deshabilitados: JUNTAS_PRODUCTION_ENABLED=false, JUNTAS_DAILY_ENABLED=false, JUNTAS_SCHEMA_READY=false; JUNTAS_APPROVED_SHA se fija al commit final de este paquete cuando se publique. Sin valores ficticios ni secretos en el repositorio.
- Concurrencia `daily-production-source-writes`, idéntica al coordinador productivo de SIME/INFoD/CeNET, cancel-in-progress=false. El lease único de D1 añade una segunda barrera ante importadores de otro repositorio. No se modifican los workflows de esas fuentes.
- Comunicados: comprobación diaria por documento, hash e identidad estable; sólo novedades/cambios producen publicaciones/revisiones.
- Padrones: sonda diaria acotada de metadatos, comprobaciones profundas en rotación semanal o ante cambios y cola histórica con presupuesto sobrante. No descargar ni procesar PDF completo cada día. Checkpoints independientes; un fallo local no bloquea otras juntas, un fallo global de autorización/persistencia sí detiene.
- La salud distingue cobertura vigente de archivo pendiente y conserva PARTIAL hasta completar el recorrido correspondiente. No se considera actualizada una fuente sólo por HTTP 200 ni por haber consumido el lote.
- Una activación diaria futura debe aprobar explícitamente la política desatendida del Environment: si exige revisión humana por corrida, el preflight bloquea schedule para evitar fingir automatización. Publicar el workflow en default, habilitar su schedule y ambos flags requiere autorización independiente posterior a la primera recuperación.
- Resumen por ejecución: solicitudes oficiales, intentos, altas/cambios/sin cambios por raíz, cobertura y cierre. Los contadores de transporte first() cuentan presencia y no representan todas las filas D1 examinadas. Observar cuotas e historial creciente sin purgas automáticas ni promesas de capacidad ilimitada.

## Preparación y publicación del Web Worker

Pruebas indispensables nuevas: **10/10**, TypeScript, ESLint y build aprobados. La prueba de 3.454 filas usa SQLite local y el DDL productivo capturado: 70 páginas de 50, filtros correctos y sin pérdida/duplicados. También cubre instalación repetida de 0100, historial íntegro, orden/cursor de Comunicados, aislamiento de datos de control, identidad/configuración, cierre con habilitación false, vencimiento, denegaciones, workflow inerte y runtime Node sin dependencias externas. No se repitió el piloto, la suite general ni las importaciones Canary.

Los dry-run de upload web y receptor pasaron, sin subir código. El build genera HTML vacío sólo para Padrones/Comunicados; datos siempre dinámicos, sin sesiones incrustadas. Inicio sin section mantiene el SSR productivo: las mediciones anteriores de `/` en el Canary redirigido **no prueban el rendimiento de Inicio productivo**. El máximo nativo de 6 ms pertenece al Canary aprobado, no a una medición del corpus productivo ni a una garantía de arranque frío.

Tras un checkout limpio del SHA autorizado y build, `node scripts/prepare-juntas-production.mjs` genera configs y manifiesto SHA-256 en `.wrangler/juntas-production-prep`. Rechaza modificaciones locales o un wrapper readonly de Canary dentro del artefacto. No hace ninguna llamada de red.

Operación web futura preparada, no ejecutada:

```powershell
node node_modules/wrangler/bin/wrangler.js versions upload --config .wrangler/juntas-production-prep/web-upload.json --keep-vars
# Registrar y comprobar ID nuevo, bindings y secretos heredados, antes de asignar tráfico.
node node_modules/wrangler/bin/wrangler.js versions deploy <VERSION_NUEVA>@100 --config .wrangler/juntas-production-prep/traffic-only.json --yes
```

Se utiliza upload de versión y asignación de tráfico para **no reaplicar rutas/Cron** del archivo histórico. Se verificó la implementación de Wrangler 4.92: versions deploy sólo sincroniza ajustes no versionados si el config los define; traffic-only no define observability/logpush/tail consumers. No asumir que deploy de una versión existente incorpora cambios de código. Mantener dominio, D1, secretos, OAuth y settings actuales; releer metadata antes/después. Si producción ya no está en la versión de referencia, detener y reconciliar localmente, sin sobrescribir cambios nuevos.

Rollback de código futuro:

```powershell
node node_modules/wrangler/bin/wrangler.js versions deploy e7d07d08-fc47-41a2-b714-61263282961b@100 --config .wrangler/juntas-production-prep/traffic-only.json --yes
```

Cerrar primero la concesión Juntas, deshabilitar sólo su automatización y restaurar tráfico si corresponde. Conservar tablas, revisiones, checkpoints y datos oficiales incorporados; no borrar el historial ni restaurar indiscriminadamente la base. Una corrección de datos excepcional requerirá autorización específica y comparación por ID/hash.

## Autorizaciones concretas pendientes

1. **Publicación selectiva** del commit final en una rama release y registro exclusivo del workflow manual en default; sin merges de ramas completas ni cambios de otras automatizaciones.
2. **DDL 0100 y receptor Juntas independiente**, comprobando cupo Free, identidad y recuperación; configuración segura de Environment/credenciales y acceso autenticado del receptor. Ninguna nueva D1.
3. **Primera recuperación oficial controlada 25 HTTP/20 publicaciones**, con comprobación y cierre, sin nuevas corridas implícitas. No equivale a declarar cobertura completa.
4. **Un despliegue web productivo selectivo** y su verificación/rollback, manteniendo settings y datos. La historia requiere 0100 previamente instalada.
5. **Activación diaria**, sólo tras la primera recuperación y aprobación explícita del horario/flags/política desatendida. No está activada por este paquete.

Puede autorizarse una única intervención supervisada que agrupe las operaciones iniciales; no se ejecutan automáticamente ni se crean nuevas etapas por este informe. La incidencia transitoria de revisión automática por cuota se resolvió al retomar por la vía normal: la consulta rechazada inicialmente no se ejecutó ni se eludió el control. Todas las lecturas productivas realizadas reportaron cero escrituras. Otras ramas y producción permanecen intactas.
