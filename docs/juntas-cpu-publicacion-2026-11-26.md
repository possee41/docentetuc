# Juntas: corrección local de CPU y candidato final — 26/11/2026

## Resultado

Corrección preparada en `local/juntas-production-cpu-20261126`, partiendo de `da61e8c3d25cabb2b3f9f581b7ccfcea27c74b58`. El SHA final se registra después del commit en `.wrangler/juntas-production-prep/production-package-manifest.json`, `codeSha`. **No se hizo ninguna operación remota en esta intervención:** sin push, deploy, consultas productivas, importaciones, cambios de secretos ni Cron. No se ejecutó 0100; ya fue aplicada y debe conservarse.

El candidato mantiene Juntas y corrige únicamente el trabajo común demostrado de `/` y `/api/public-app`. Está listo para una validación nativa acotada de lectura; **todavía no se declara apto para producción en Workers Free** sin medir la versión corregida remotamente, especialmente MISS y BYPASS.

## Métrica y evidencia nativa existente

Los registros guardados en el informe productivo anterior provienen del tail de Wrangler y registran CPU por invocación (`cpuTimeMs`), Wall Time (`wallTimeMs`), versión, ruta y outcome. No son tiempos de `performance.now()` ni duración SQL. El startup de 22 ms informado por el upload es una métrica distinta. Referencias oficiales: [Workers timing](https://developers.cloudflare.com/changelog/post/2025-04-09-workers-timing/) y [Workers Trace Events](https://developers.cloudflare.com/logs/logpush/logpush-job/datasets/account/workers_trace_events/).

| Evidencia remota previa | CPU nativa | Wall Time | Observación |
|---|---:|---:|---|
| Candidato anterior `/` | 83 ms | 99 ms | HTTP 200, outcome ok |
| Candidato anterior `/api/public-app` | 87 ms | 1.035 ms | HTTP 200, outcome ok; no se guardó el estado HIT/MISS |
| Producción restaurada `/` | 59 ms | 65 ms | HTTP 200, outcome ok |
| Rutas Juntas candidatas | 0–5 ms | según ruta | no son las rutas costosas |

No existe medición nativa posterior de este nuevo candidato. Las muestras anteriores no tienen condiciones de frío/caché idénticas y no demuestran que Juntas cause la diferencia 59→83. El costo alto de portada también existe en la versión productiva anterior.

## Causa comprobada y corrección

1. **Portada:** React/SSR vuelve a generar en cada solicitud el HTML inicial de una aplicación que aún no tiene publicaciones ni sesión cargadas. El perfil local registra trabajo de renderizado/carga del framework incluso en las repeticiones. Ya existía antes de Juntas. Se reutiliza el mecanismo de documento público generado durante build: ahora también genera la portada, con el mismo HTML inicial completo y sus referencias del mismo build. No se embeben datos D1 ni personales. RSC, rutas privadas, deep links y consultas de portada siguen por el framework. GET/HEAD conservan su semántica. No se congelan datos ni fechas de registros.
2. **API pública:** la selección devuelve 400 publicaciones y un payload de **1.934.914 bytes**, dominado por metadatos. La ruta anterior pasa por el framework, materializa objetos con 35 campos y vuelve a codificarlos con `Response.json`; incluso HIT tiene trabajo de framework evitable. Se extrae un handler compartido y se añade una entrada ligera equivalente, como la ya utilizada en las APIs Juntas. La ruta convencional delega al mismo handler y usa el acceso D1 nativo, sin inicializar Drizzle innecesariamente.
3. **Codificación:** se conserva literalmente `APP_PUBLICATIONS_QUERY`, con sus filtros, orden y límites. Se añade una proyección exterior `json_object` por fila; SQLite codifica cada publicación y el Worker une esas filas JSON, conservando todos los campos/valores. No se agrega un JSON único en D1 para todo el catálogo, que podría superar el límite de un valor. No se truncan summary/metadata ni se reduce el catálogo. La lista explícita de 35 columnas se comprueba contra el esquema local representativo; futuras migraciones que cambien el contrato deberán actualizar esa proyección.

No cambian TTL (60 s), clave/versión de caché, exclusión de parámetros desconocidos, privacidad, expiración, manejo de fallos ni tablas/índices. La respuesta mantiene campos personales nulos/vacíos y no consulta sesiones ni datos privados. Las rutas personales, administrativas y de autenticación no entran en el fast path.

## Comparación acotada reproducible

Se utilizaron dos builds existentes identificados (base `85c4a91`, candidato `da61e8c3`) y el código corregido. Todos sobre **el mismo snapshot público de 5.146 publicaciones y 10 filas sync**, SQLite local, sin red externa. Por variante se realizaron seis lecturas: tres de portada, MISS, HIT y BYPASS. Hubo un experimento intermedio de entrada ligera sin codificación por fila para separar sus efectos; no se hicieron benchmarks remotos ni cargas masivas.

| Ruta/condición | Base 85c4a91: V8 local muestreado | Integrado anterior: V8 local muestreado | Corregido: V8 local muestreado |
|---|---:|---:|---:|
| Portada primera | 90,083 ms | 86,479 ms | por debajo de resolución: 0 muestras activas |
| Portada repetida 1 | 17,540 ms | 17,958 ms | por debajo de resolución: 0 muestras activas |
| Portada repetida 2 | 14,815 ms | 12,857 ms | por debajo de resolución: 0 muestras activas |
| API MISS | 132,428 ms | 112,750 ms | 14,281 ms, baja resolución |
| API HIT | 53,871 ms | 46,867 ms | por debajo de resolución: 0 muestras activas |
| API BYPASS | 107,309 ms | 90,838 ms | 48,305 ms, baja resolución |

**Estos valores son perfiles V8 locales, no CPU nativa Cloudflare.** El estimador suma muestras no idle, incluyendo tiempo atribuido a `(program)`: en BYPASS corregido 40,439 ms quedaron en ese frame, sin atribución suficiente a código JS propio. No se elimina ese dato del resultado ni se considera una certificación de 10 ms. Cero muestras activas no significa CPU cero. Las operaciones cortas tienen pocos puntos de muestreo. La latencia local corregida fue 7,124 ms en la primera portada, 3,979–4,113 ms en repeticiones, 102,849 ms en MISS, 27,184 ms en HIT y 72,600 ms en BYPASS; tampoco equivale a CPU nativa.

La entrada ligera sin codificación redujo el MISS local a 58,214 ms y HIT a cero muestras activas; añadir codificación por fila redujo el MISS a 14,281 ms. La comparación causal local identifica trabajo evitable sin atribuir el pico nativo a índices o consultas nuevas de Juntas.

Dos SELECT adicionales sobre el mismo D1 local comprobaron selección original frente a la proyección JSON: **400 filas idénticas, 11.536 filas leídas en ambos casos, cero escrituras**. Duración SQL local individual 26/25 ms; no se presenta una sola pareja como una mejora estadística SQL ni como medición D1 productiva. El payload original, integrado y corregido coincide **byte por byte**. El texto visible inicial de la portada también coincide.

Evidencia local ignorada: `.wrangler/public-web-cpu/{baseline,integrated,optimized,optimized-json}/measurements.json`, perfiles `*.cpuprofile`, `equivalence.json` y `sql-cost.json`. Snapshot SHA-256: `18f6a9cabf4883b16858754ac983d416f72ea644dddd608f99fc0d5f94128431`. No se publican snapshots de registros en Git.

Reproducción: `node scripts/profile-public-web-local.mjs BUILD SNAPSHOT_PUBLICO.json DIRECTORIO_NUEVO`. Usar el mismo snapshot y un directorio local nuevo por variante. El ejecutor limita el fixture a 8.000 filas, bloquea red externa y sólo usa SQLite local. Necesita las dependencias ya instaladas; no usa Wrangler remoto ni credenciales. Los JSON de evidencia permiten revisar los resultados sin repetir el perfil.

## Pruebas finales y conservación

**22/22 pruebas focalizadas aprobadas:** 12 de integración Juntas, tres nuevas de CPU/contrato/seguridad, seis de caché real y una del medidor Canary existente ejecutado exclusivamente en local. Se omitió explícitamente el benchmark repetitivo de caché. TypeScript, ESLint focalizado y build final aprobados. Los fallos de prueba inducidos de DB devuelven 503 sin almacenar errores en caché; no son fallos reales de infraestructura.

- Portada generada idéntica al SSR del mismo build, sin DB ni red externa, con cookie sintética y fecha local simulada en 2050. No se alteró ningún reloj remoto.
- Contrato JSON probado con 35 columnas, 400 filas, nulls, escape Unicode, metadatos grandes y orden. Contenido idéntico del snapshot real entre versiones.
- Privacidad entre dos usuarios sintéticos, HIT/MISS, expiración exacta a 60 s, sin renovación al leer, parámetros desconocidos, desactivación de caché, errores DB y rutas privadas intactos.
- DDJJ PDF/Word, Trámites, Licencias y modelos descargables preservados por las comprobaciones de integración y el empaquetado. `app/docente-app.tsx` y `lib/useful-information.ts` no se modifican frente al candidato anterior.
- Juntas conserva consultas, clasificación, paginación, controles, historial y receptores ya validados. No cambian 0100, fuentes, checkpoints, importadores ni automatizaciones. El tooling de medición de caché se adapta a la misma proyección SQL; no se despliega ni habilita ese tooling.

## Credencial Drive: ubicación y procedimiento seguro

No falta un binding de la Web. El recolector **Node** requiere `GOOGLE_DRIVE_API_KEY`; el receptor independiente requiere otro secreto de autenticación, `JUNTAS_IMPORT_SECRET`, que no sustituye a la clave Google. En este entorno no está definida la variable Drive ni existe `%LOCALAPPDATA%\DocenteTucCanary\google-drive-key.dpapi`. Sólo se comprobó presencia, sin leer secretos.

Reutilizar la clave existente, sin generar otra. Cuando se autorice continuar la recuperación, el propietario puede pegar estas instrucciones juntas en PowerShell; la clave se introduce **después**, en el prompt oculto, nunca en el comando/chat/repositorio:

```powershell
$juntasKey = Read-Host 'Clave Google Drive API existente (oculta)' -AsSecureString
if ($juntasKey.Length -lt 10) { throw 'Clave vacía; no se guardó' }
$juntasKeyDir = Join-Path $env:LOCALAPPDATA 'DocenteTucCanary'
New-Item -ItemType Directory -Force -Path $juntasKeyDir | Out-Null
$juntasKey | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $juntasKeyDir 'google-drive-key.dpapi') -Encoding utf8
$juntasKey.Dispose()
```

No ejecutar estas instrucciones como parte de este trabajo. No cambian la política de ejecución Windows ni crean un archivo de clave en texto plano. DPAPI queda ligado al mismo usuario/equipo que ejecutará Node. El operador consume la clave sólo en memoria y no registra URLs con `key=`. Para GitHub Actions futuro, la misma clave debe configurarse mediante el formulario de Secrets del Environment del recolector autorizado; no en el Worker Web ni en variables públicas. No se probará acceso Drive hasta autorizar las solicitudes oficiales de la recuperación. Restricción esperada ya acordada: sólo Google Drive API; no compartir el valor por chat.

## Condiciones concretas de publicación y recuperación

1. Autorizar una comprobación Canary exclusivamente de rendimiento/lectura: nuevo candidato, sin recolección, sin concesión, sin migraciones productivas ni escritura productiva. Medir por versión CPU nativa individual de portada y API MISS/HIT/BYPASS con un volumen equivalente al payload de 1,93 MB; un catálogo diminuto no sería evidencia suficiente. Hasta 12 GET acotados, no una carga. Si el dataset Canary no permite esas condiciones, detener y declarar la limitación.
2. Aprobar sólo con HTTP correcto, resultados iguales, sin errores/outcomes CPU y CPU nativa con margen razonable (objetivo <=7 ms, ningún caso >=10 ms). El MISS y BYPASS son bloqueos pendientes de evidencia, no verificaciones aprobadas por este informe.
3. Antes de producción, autorización final para publicar/desplegar el SHA nuevo. Releer versión activa `6fb7a6a2-1552-4e43-9e2d-9d054e370419`, bindings y tráfico; detener ante drift. Verificar el manifiesto y cuatro documentos. **No ejecutar 0100:** verificar su presencia/compatibilidad mediante lectura cuando esté autorizado.
4. Subir el artefacto mediante `wrangler versions upload --config .wrangler/juntas-production-prep/web-upload.json --keep-vars`; validar metadatos y desplegar el ID devuelto al 100 % con el config traffic-only. No enviar vars, rutas ni triggers.
5. Rollback de código: `wrangler versions deploy 6fb7a6a2-1552-4e43-9e2d-9d054e370419@100 --config .wrangler/juntas-production-prep/traffic-only.json --yes`. No restaura D1 ni elimina 0100. La referencia de deployment en el manifiesto es la última verificada, `26986bd9-2d6d-4336-b449-71f7169facdd`, y se debe releer antes de cambiar tráfico.
6. La recuperación documental es una operación distinta: requiere la clave segura disponible, equivalencias documentales, credencial propia del receptor, cierre independiente, cuotas y una única ventana de hasta 25 HTTP/20 publicaciones. No fue iniciada aquí. No activar Cron ni notificaciones.

El informe queda cerrado con candidato local y evidencias. No se amplía la intervención a otros módulos ni se continúa automáticamente con operaciones remotas.
