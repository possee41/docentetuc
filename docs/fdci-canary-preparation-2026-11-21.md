# FDCI — Canary finito preparado para autorización

Fecha: 21/11/2026, Tucumán. Base: `da27b9b56ec4dfc9b9607c24ae88cb8919473ada`. Este documento no autoriza ni ejecuta despliegues, escrituras remotas, importaciones productivas o Cron.

## Evidencia nueva de solo lectura y prueba local con la fuente real

- La API oficial devolvió `getCapaActivas=1` y `getRestoCapas=262`; ningún curso del listado anunciaba una fecha próxima en ese momento. El único activo era el curso 3122, comisión **6450**, «XI Coloquio ALEDAr – Capítulo Argentina: \"Los Estudios del Discurso frente al espejo\"». El detalle estructurado confirmó apertura `20/11/2026 23:00`, cierre `23/11/2026 08:00`, `isActivePre=1`, `comision_cerrada=0` y 313 lugares de preinscripción. [Ficha oficial](https://capacitaciondocente.educaciontuc.gov.ar/capacitaciones/NJ49Ee1g/xi-coloquio-aledar-capitulo-argentina-los-estudios-del-discurso-frente-al-espejo/6450).
- Un `SELECT` productivo devolvió 270 publicaciones FDCI y **cero** filas para `fdci:commission:6450`; última observación FDCI 1/11/2026 10:25:45 UTC, `rows_written=0`. Es una oportunidad abierta que la sincronización desactivada no publicó.
- `scripts/probe-fdci-official-local.mjs` ejecutó el recolector real contra tres respuestas oficiales y el gateway real contra **D1 en memoria**, sin gateway remoto: `created=1`, `fdci:commission:6450`, `ACTIVE`, `dateStatus=confirmed`, ventana `2026-11-20T23:00:00-03:00`–`2026-11-23T08:00:00-03:00`, checkpoint ciclo 2/revisión 3/`OK`, sin cursor pendiente. La detección de una apertura futura sigue cubierta por las pruebas de #6441 con fuente simulada; al 21/11 no había una próxima oficial disponible para demostrarla en vivo.
- El Worker Canary aislado `docentetuc-fdci-functional-canary-1-2` (cuenta `6bbc3dae7e111660f0c835677ceffb69`, D1 `3e84a257-cbac-4023-a0a3-148a3441dd62`) no tuvo despliegues posteriores al 6/11; versión efectiva según el último deployment `c45792e7-a85e-4342-b692-c3864c84c630`. D1 Canary: cero publicaciones, cero concesiones activas, checkpoint inicial ciclo 1/revisión 0/cursores vacíos, dos candidatos delta previos, control de automation `HALTED`, cero perfiles y notificaciones. La fila de concesión vencida y los dos candidatos deben conservarse; el ensayo nuevo usa `FDCI_DELTA_ENABLED=false`.

## CPU y D1 disponibles antes de la prueba remota

La página actual de [límites Workers](https://developers.cloudflare.com/workers/platform/limits/) fija 10 ms de CPU por HTTP en Free; la de [D1](https://developers.cloudflare.com/d1/platform/limits/) fija 50 consultas por invocación Free. El perfil local usa Workerd/D1 aislado con instrumentación y muestras V8 de baja resolución; **no es CPU nativa facturada por Cloudflare**. En dos ejecuciones, la mediana muestreada de primera inserción actual varió entre 9,487 y 4,833 ms; por ello no se infiere margen. El Canary previo del 5/11, en otra ruta delta, registró `start=10 ms` de CPU remota y no aprobó.

| Operación local actual | Consultas D1 por invocación | Filas leídas | Filas escritas | Nota |
|---|---:|---:|---:|---|
| Identidad autenticada | 1 | 1 | 0 | Lectura |
| Apertura de concesión | 3 | 3 | 1 | TTL 600 s |
| Primera inserción, payload habitual | 4 | 3 | 5 | Incluye efectos de triggers |
| Primera inserción, título 500, resumen 2000 y metadata ~5800 caracteres | 4 | 3 | 5 | Mayor carga admitida por receptor |
| Actualización de contenido | 4 | 5 | 3 | Incluye historial/triggers |
| Reobservación idéntica | 4 | 5 | 1 | Solo avanza `last_seen_at` |
| Checkpoint `get` | 3 | 3 | 0 | Lectura |
| Checkpoint `start`, `advance` o `finish` | 3 | 5 | 1 | Cada una por separado |
| Cierre de concesión | 4 | 4 | 1 | Confirmación de cierre |

El modo histórico `create-only` fue reforzado: ahora usa `INSERT ... ON CONFLICT DO NOTHING` bajo la concesión, para que una inserción concurrente jamás se convierta en actualización. Una prueba local fuerza esa carrera y comprueba conflicto 409 con la fila concurrente intacta. Esto no modifica el camino de importación diaria. La CPU nativa individual de inserción normal, carga máxima, actualización, deduplicación, checkpoint y consultas **sigue pendiente** del Canary autorizado.

## Entorno y presupuesto que requieren autorización explícita

La configuración local `wrangler.1.2-fdci-functional-canary-finite.jsonc` fija **exactamente** el Worker/D1 anterior, un único binding `DB`, sin rutas, previews ni Cron. Solo habilita temporalmente `workers_dev`, `IMPORT_GATE_LEASE_REQUIRED=true` y `FDCI_EXTERNAL_ENABLED=true`; conserva `IMPORT_GATE_ENABLED=false`, automation y delta apagados. Se usará un secreto FDCI sintético exclusivo generado en memoria y retirado al cerrar. No se toca producción, ni las dos entradas delta previas, ni los 366 históricos.

Presupuesto máximo del único ensayo: **1 despliegue funcional inicialmente cerrado, 1 activación temporal del mismo Worker, 1 cierre desplegado; 1 secreto temporal y su eliminación; 21 solicitudes HTTP autenticadas al gateway como máximo; 6 lecturas oficiales como máximo; 2 altas de publicaciones Canary, 1 actualización de contenido y 2 reobservaciones idénticas como máximo; 0 usuarios, 0 avisos, 0 escrituras en D1 productiva.** Una consulta de fuente que cambie el número o identidad de comisiones activas fuera del presupuesto suspende el ensayo. Duración de la exposición <=30 minutos y concesión <=600 s. No hay segundo intento automático ni reintento ciego de mutaciones.

Secuencia funcional dentro de ese presupuesto: lectura de identidad; apertura de concesión; una corrida incremental con la comisión activa oficial 6450 si sigue abierta; reobservación idéntica; una corrida con una comisión **sintética** de apertura futura y horario de Tucumán; actualización de esa misma comisión cambiando el dato fuente; reobservación idéntica; lectura final de checkpoint; cierre de concesión. Si #6450 ya cerró, el ensayo solo podrá demostrar el activo con fixture sintético; se informará expresamente. El fixture de futura nunca se presentará como capacitación real y solo existe en D1 Canary sin perfiles ni push.

Antes de abrir: volver a verificar versión efectiva, binding, bandera de exposición, D1 vacía, concesión vencida, checkpoint y candidatos anteriores; exportar respaldo privado de la D1 exclusiva y comprobarlo en SQLite local. Preparar el cierre independiente antes de cualquier habilitación. Fijar el SHA final del commit y verificar el código desplegado cerrado. No aplicar migraciones ni reiniciar el checkpoint.

**Medición nativa:** conciliar *cada* invocación con el Invocation Log de Cloudflare por versión, ruta, Ray/request ID y HTTP; guardar CPU individual y wall por separado, además de `rows_read/rows_written` de los ACK que los exponen y la conciliación final D1. No sustituir CPU individual por latencia, percentiles agregados o muestreo local. Suspender nuevas llamadas si cualquier operación supera **7 ms** preventivos, se acerca a 10 ms sin margen reproducible, produce 1102, pierde ACK, carece de log correlacionable, cambia identidad o excede el presupuesto. Si aparece un cuello concreto, optimizar solo ese camino y repetir con autorización renovada; una muestra sin margen no habilita producción.

Al terminar o fallar: cerrar por owner si es posible, expirar concesión, desplegar `wrangler.1.2-fdci-functional-canary.jsonc` con gate/lease/external/automation/delta en `false`, eliminar secreto, deshabilitar workers.dev, verificar por lectura cero concesiones activas, ninguna ruta/Cron, candidatos delta intactos y cambios de publicaciones dentro del presupuesto. No borrar publicaciones Canary para ocultar el resultado.

## Integración y condiciones productivas

La rama de restauración conserva `b7731b9`, alertas urgentes y sus pruebas. El ensayo de `git merge-tree` contra `fix/navigation-community-1.1` detectó **cinco conflictos ajenos a FDCI** (`app/api/ai/chat/route.ts`, `components/docentetuc-ai-panel.tsx`, `lib/ai.test.ts`, `lib/ai.ts`, `lib/community-layout.test.ts`). La rama predeterminada y este paquete divergen en 2 y 227 commits, respectivamente. No se fusionaron ni reemplazaron los trabajos paralelos. Integrar sobre la rama consolidada, resolver esos archivos con sus propietarios y volver a probar; evitar una aceptación masiva de «ours»/«theirs».

Producción solo queda habilitable cuando el mismo SHA integrado pase CPU nativa Canary con margen, primera inserción y actualización reales, deduplicación, cursor, fallo/reanudación y cierre; cuando el gateway y la web estén desplegados inicialmente cerrados y con identidad D1 comprobada; y cuando una corrida manual productiva acotada confirme por lectura la comisión vigente en API/vistas sin alertas falsas. Solo después, y con autorización distinta, descomentar el calendario diario, habilitar el workflow y el opt-in de automatización/CPU para el SHA aprobado. INFoD y CeNET mantienen sus rutas independientes y se revalidarán en la rama integrada.
