# SIME: mantenimiento diario preparado — 13/11/2026

**Dictamen: implementación local preparada; automatización NO activada.** Rama `local/sime-daily-completion`, basada en el runtime productivo validado `301bd106a94ae7354f37bab66ee6dcf9f30c3ce8`. No hubo push, cambios remotos, importaciones, escrituras D1, despliegues, cambios de credenciales ni activación de Cron en esta tarea. El informe de la recuperación anterior se conservó intacto.

## Solución y problemas corregidos

Se conserva GitHub Actions → receptor independiente existente → D1. No se reconstruye el recolector, no se cambia la web ni se necesita otro despliegue de código Worker o una migración.

- **Hasta 48 publicaciones por jornada de Tucumán.** Primero se distribuyen hasta 12 por junta; los cupos libres se redistribuyen entre las juntas con pendientes. Se priorizan publicaciones actuales/próximas y se reserva avance histórico. Los cursores solo avanzan tras ACK y se conservan al cambiar el runtime. Un segundo intento programado en el mismo día se rechaza antes de HTTP; tampoco se permiten reruns de GitHub.
- **Detalles con rotación durable**, independiente del cursor de escrituras y de las fechas guardadas en D1. Evita consultar siempre los mismos detalles cuando su hash no cambia. Máximo tres detalles por junta y una comprobación histórica adicional por junta: **24 solicitudes oficiales como techo por ejecución**, sin reintentos. Lecturas de detalle repetidas dentro de una ejecución comparten respuesta, incluso si hubo error. Los redirects se rechazan.
- **Diferidos verificables.** El pendiente ausente del listado actual se resuelve solo con detalle oficial fresco que confirme el mismo ID y código y fechas de inscripción completas ya vencidas. Se conserva el contexto anterior y la metadata más reciente de D1; nunca se elimina el registro ni se lo presenta como una inscripción nueva abierta. Datos ausentes, HTTP fallido o fechas no concluyentes dejan el pendiente sin resolver y permiten continuar los demás. Una identidad contradictoria suspende persistentemente.
- **Juntas independientes, integridad conjunta.** Si falla una junta, solo se envían publicaciones de las juntas cuya lectura terminó correctamente. Se conservan todos los pendientes de la fallida. No se informa OK ni se actualiza el último éxito completo hasta comprobar las cuatro juntas y dejar la cola vacía. Si fallan todas, no se escriben publicaciones ni sync_state. Las concesiones se cierran igualmente.
- Se corrigió un cambio ficticio de hash: la nota de ausencia del listado desaparecía al refrescar un detalle histórico y reaparecía luego. Ahora permanece estable, evitando escrituras causadas por esa oscilación.
- **Observabilidad:** resultado y resumen de GitHub con ACK por junta, pendientes, diferidos, errores por junta, lecturas oficiales, contadores D1 de batches y cierre. Git conserva el último resultado conocido y el día consumido. Los datos desconocidos se muestran como desconocidos; no se imprimen artículos completos, datos del designado, tokens ni CPU estimada.

El receptor mantiene el límite de metadata 32.000 ya validado en producción. La concesión sigue siendo de hasta 600 segundos, autenticada y asociada al run-ID. Se conservan CAS, checksums, suspensión ante escrituras ambiguas y cierre independiente de la señal de cancelación. El fallo de cierre preserva los ACK conocidos y deja HALTED. El código no reabre un ledger suspendido automáticamente.

## Evidencia concreta

**49/49 pruebas focalizadas aprobadas**, sin omitidas:

`node --experimental-strip-types --test scripts/sime-maintenance.test.mjs scripts/sime-production-recovery.test.mjs lib/sime-publications.test.ts`

Incluyen handlers HTTP y SQLite local con el esquema productivo, concurrencia, ACK perdido, interrupción, cierre fallido/independiente, fallos parciales por junta, rechazo de identidad, fecha futura/no verificable, conservación de metadata y límite de solicitudes. Se verificó TypeScript para `lib/sime-collector.ts` y su grafo importado, sintaxis Node, YAML generado y diff. No se ejecutó la suite general ni benchmarks masivos.

También se ejecutó **localmente el validador extraído del bundle productivo verificado** contra los 89 payloads reales conservados de la generación 273: **89 aceptados, cero rechazados**, máximo de metadata 10.859 caracteres y summary 1.815. No se invocó el receptor remoto ni se consultó nuevamente la fuente para ese control. Esto demuestra compatibilidad de los payloads registrados; no confirma su vigencia actual ni sustituye la comprobación oficial de cada diferido.

Se reprodujo **localmente** la distribución del backlog registrado: junta 1, 36 actuales + 4 diferidos; junta 2, 0 + 1; junta 3, 35 + 10; junta 4, 0 + 3. Total 89. Las respuestas y registros de ese E2E son fixtures; no constituyen nuevas comprobaciones oficiales de los 89 registros.

| Ejecución lógica | ACK, incluidas actualizaciones de detalles | Pendientes al finalizar | Diferidos restantes |
|---|---:|---:|---:|
| 1 | 48 | 41 | 14 |
| 2 | 40 | 11 | 11 |
| 5 | 9 | 5 | 5 |
| 10 | 8 | 0 | 0 |
| 13–16 | 0 | 0 | 0 |

En el escenario estable se resolvieron las 71 publicaciones actuales en las primeras dos ejecuciones y los históricos continuaron hasta la décima. Se crearon exactamente 89 IDs únicos; las actualizaciones adicionales correspondieron a detalles enriquecidos. No hubo OK anticipado ni escrituras de publicaciones en las últimas cuatro repeticiones. **No es una promesa de plazos productivos**: nuevas publicaciones, revisiones o fuentes fallidas pueden extenderlos.

Inspecciones remotas realizadas, exclusivamente de lectura:

1. Un detalle público oficial de `sime:144440`, a las 16:12:31 UTC del 13/11. HTTP 200, ID/código coincidentes, fechas 06/11 08:00 → 11/11 08:00. Se excluyeron datos personales de la evidencia y del fixture. Demuestra el mecanismo para ese caso; no se asumió que los demás 17 estén verificados.
2. `/api/public-app`: HTTP 200; las cinco altas recientes de Secundaria están presentes. Comprobación de navegador en **Inscripciones SIME → Todas → Secundaria**: cinco tarjetas y presencia de `sime:144389`, trámite `PDVC-20261104-145326`. No hizo falta cambiar consultas ni filtros públicos.

## Publicación y activación mínimas que requieren autorización

1. Publicar selectivamente el nuevo commit local y el parche de **un solo workflow** en `possee41/docentetuc`, rama predeterminada `fix/navigation-community-1.1`. El runtime queda fijado al SHA completo nuevo. INFoD/CeNET conservan sus SHA, horarios y flags. No se cambia el permiso existente `contents: write`, que sigue siendo de repositorio y se usa mediante ramas fijas/CAS; no se presenta como un token limitado a una rama.
2. Releer el estado SIME y su revisión. Si sigue limpio, preparar y aplicar **por CAS** únicamente su actualización de identidad de runtime; conservar cola, hashes, generación progresiva, cursores, historial y run-ID de recuperación consumido. Referencia registrada: generación 273, 89 pendientes, rama `daily-state-production-sime`, commit `6604ecce201a0a278617ffb0d819568426087364`. Si hubo cambios, comparar; no sobrescribirlos.
3. Actualizar solo `DAILY_PRODUCTION_SIME_APPROVED_SHA`, habilitar `DAILY_PRODUCTION_SIME_ENABLED=true` y establecer **solo** `SIME_IMPORT_ENABLED=true` en el receptor existente, preservando todos los demás settings. Esto habilita la capacidad autenticada de solicitar concesiones, **no importaciones públicas sin concesión**. Se mantienen `IMPORT_GATE_ENABLED=false` y `IMPORT_GATE_LEASE_REQUIRED=true`. El flag de recuperación manual permanece deshabilitado y no se crea un run-ID secreto.
4. Reanudar el horario SIME **ya existente**: `7 9 * * *`, 06:07 de Tucumán. No agregar horarios ni ejecutar otra recuperación manual. Supervisar la primera ejecución programada, comprobar ACK/D1, PARTIAL/OK real, cierre y consumo. GitHub puede retrasar el disparo: no se promete comienzo exacto a las 06:07.

Comandos de preparación **offline**, antes de aplicar nada remoto:

```text
node scripts/prepare-sime-production-package.mjs maintenance WORKFLOW_ACTUAL.yml SHA_NUEVO workflow-candidato.yml
node scripts/prepare-sime-recovery.mjs upgrade ESTADO_SELLADO.json 301bd106a94ae7354f37bab66ee6dcf9f30c3ce8 SHA_NUEVO estado-candidato.json
```

Ambos generan archivos nuevos sin sobrescribir ni publicar. El upgrade rechaza HALTED, propietario activo, concesión Git o intención en vuelo. Debe verificarse también ascendencia del nuevo commit y la revisión remota antes del CAS. Los SHA-256 normalizados del paquete se registran en `sime-daily-maintenance.sha256.json`; los archivos finales con SHA literal se generan después del commit para evitar autorreferencia.

## Riesgos restantes, suspensión y recuperación

- **Capacidad máxima: 48 escrituras de publicaciones/día**, compartidas entre las juntas. Las lecturas oficiales no son escrituras Worker; el procesamiento pesado permanece en Node. Si llegan más cambios que esa capacidad sostenidamente, no se garantiza actualización integral en 24 horas. El backlog queda visible y durable; no se aumenta automáticamente la frecuencia.
- Un diferido sin identidad/fechas verificables puede continuar pendiente. No se borra ni se declara completo para esconderlo. Las juntas sanas siguen avanzando y el resumen identifica el bloqueo.
- La paginación de metadata D1 y el tamaño del ledger siguen creciendo con el historial. La ventana de 600 segundos y el límite de estado de 8 MB continúan vigentes; al alcanzarlos debe conservarse el estado y revisarse la causa, no reiniciarlo. No existe garantía de cuota futura de toda la cuenta: la web comparte los límites gratuitos.
- **CPU individual no disponible para la ejecución anterior por HTTP 403.** Esta variante no agrega trabajo al código Worker ni requiere Workers Paid. Se conservan Invocation Logs y Ray ID para correlacionar desde el Dashboard autorizado. No se afirma cumplimiento sostenido de CPU a partir de SQLite o tiempos HTTP. Un error de receptor/cuota/1102 no provoca reintento de escritura y una intención incierta queda suspendida.
- Un cierre fallido requiere bloquear nuevas ejecuciones y comprobar la concesión. No retirar credenciales antes de confirmar cierre. El cierre autenticado por fuente/propietario funciona con SIME deshabilitado; la concesión también expira. Una muerte forzada del runner no garantiza `finally`: si hay intención en vuelo, requiere conciliación explícita de hash/identidad/propietario, no recuperación automática ciega.

Para suspender: deshabilitar solo el flag diario SIME, cerrar la concesión correspondiente, verificar cero concesiones y poner `SIME_IMPORT_ENABLED=false`. Conservar ledger, credencial y evidencia hasta confirmar cierre. No afecta INFoD/CeNET. Para revertir código: mantener SIME detenido, revertir selectivamente el workflow y revisar la identidad del ledger; **no** rebobinar ACK ya aplicados ni restaurar toda D1.

**Autorización concreta necesaria:** publicación selectiva del nuevo runtime y workflow, actualización CAS de identidad del estado limpio y activación del horario SIME existente con sus flags autenticados, supervisando la primera ejecución automática. No requiere desplegar la web, desplegar nuevo código del receptor, migrar D1, crear credenciales, importar sintéticos ni repetir pilotos Canary.
