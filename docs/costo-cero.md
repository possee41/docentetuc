# Auditoría de costo $0

## Diagnóstico

Antes de esta optimización, el cron `*/5 * * * *` ejecutaba una sincronización completa 288 veces por día. Cada ejecución recuperaba las 621 publicaciones actuales y hacía un `UPSERT` de cada fila aunque `content_hash` no hubiera cambiado: aproximadamente `621 × 288 = 178.848` escrituras de publicaciones diarias, más seis filas de `sync_state` por ejecución. La medición de D1 confirmó el efecto: 126.447 filas escritas en las últimas 24 horas con una base de sólo 3,22 MB.

El segundo foco era `CIERRE_PROXIMO`: el materializador recorría todos los perfiles contra todas las vacantes/capacitaciones compatibles y había generado 3.638 notificaciones para un único evento masivo. La entrega push sí era idempotente por `endpoint/event_key`, pero la notificación in-app ya había sido creada.

## Cambios aplicados

- Las publicaciones se comparan por `content_hash`; sólo se insertan nuevas o modificadas.
- La sincronización de fuentes corre una vez por hora; el dispatch de push continúa cada cinco minutos.
- El perfil no se reescribe cuando el correo no cambió.
- `CIERRE_PROXIMO` sólo se materializa para publicaciones guardadas por el docente.
- Las alertas automáticas de capacitaciones requieren `notify_new_trainings` y respetan el umbral/configuración existente.
- Se mantienen D1, push, VAPID, Service Worker, Gemini, matching, historial y datos existentes.

En una hora sin cambios, el costo fijo de sincronización queda en seis actualizaciones de `sync_state` (aprox. 144 filas/día), cero publicaciones reescritas y cero notificaciones nuevas. Las escrituras restantes representan acciones reales: perfil, guardados, agenda, recordatorios, IA o una fuente que cambió.

## Escala estimada

Con usuarios que sólo leen y abren la app una vez al día, las escrituras diarias siguen siendo las 144 de `sync_state`, independientemente de si hay 1, 10, 100, 500 o 1.000 usuarios, porque la lectura no reescribe perfiles. Si cada usuario hace una acción persistente diaria, se suma aproximadamente una escritura por acción; cada consulta de IA suma su control de límite. Es una estimación por operación observada, no una predicción de tráfico.

## Arquitecturas comparadas

| Opción | Encaje actual | Decisión |
| --- | --- | --- |
| D1 optimizado | Conserva datos personales, alertas y multi-dispositivo | Elegida ahora |
| JSON/Assets estáticos | Bueno para publicaciones públicas, pero requiere pipeline de publicación e invalidación | Evaluar cuando crezcan las lecturas |
| Cache API/KV/R2 | Reduce lecturas repetidas, añade consistencia e invalidación | No migrar todavía |
| Turso/Supabase | Alternativas válidas, pero implican migración, Auth/cron y nuevas superficies operativas | No migrar |

Cloudflare D1 Free incluye 5 millones de filas leídas/día, 100.000 escritas/día y 5 GB; Workers Free incluye 100.000 requests/día. Turso Free publica 500 millones de filas leídas y 10 millones escritas por mes; Supabase Free incluye 500 MB de base y 50.000 MAU, pero sus proyectos pueden pausarse por inactividad. Fuentes: [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/), [Turso pricing](https://turso.tech/pricing), [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

