# Canary integrado FDCI: preparación cerrada

No se ha desplegado ni escrito en D1. El único destino permitido para este ensayo es
`docentetuc-web-juntas-canary-1-2`, D1 `0979f2c2-0e96-4b5c-811b-adcccc2dbd6d`,
namespace SQLite `fd5a575222df418ca357f59e87ab3183`. El otro Canary web de FDCI
no tiene binding `PUBLIC_SNAPSHOT` y no sirve para esta medición. El Worker de
producción `docentetuc` y D1 `baaf5886-0123-4948-96da-aa7106424549` quedan fuera.
El tag de migración original del Worker Canary es `public-snapshot-canary-v1`;
se conserva exactamente para reutilizar la clase y namespace existentes.

## Preparación local y preflight remoto de solo lectura

1. Ejecutar el build integrado y `node scripts/prepare-public-snapshot-canary.mjs`.
   El Wrangler del ensayo arranca cerrado, sin rutas, Cron ni FDCI automática.
   La clase de cierre sólo existe en el bundle Canary; la compilación productiva
   sigue usando `lib/public-snapshot.ts`.
2. Antes de cualquier despliegue, comprobar por API el nombre efectivo, binding
   D1 exacto, namespace exacto, versión previa, ausencia de Cron y rutas, y los
   flags FDCI cerrados. Si difiere uno, detenerse. El namespace pertenece al
   Worker Canary y sus dos objetos históricos no tienen datos almacenados.
3. Exportar **la D1 Canary** a `.wrangler/fdci-public-canary/before.sql` y guardar
   versión, lista de objetos, definiciones de los tres triggers históricos,
   conteos y hashes ordenados de publicaciones, revisiones, checkpoints y firmas.
   Confirmar que no existen `public_snapshot_revision` ni `fdci_import_checkpoint`,
   que no hay publicaciones FDCI ni IDs con prefijo `fdci:canary:snapshot:20261127:`.
   Estos hechos se observaron el 27/11/2026 y deben revalidarse antes de escribir.

   ```powershell
   node node_modules/wrangler/bin/wrangler.js d1 export docentetuc-sources-canary-1-2 --remote --config wrangler.1.2-public-snapshot-canary.jsonc --output .wrangler/fdci-public-canary/before.sql
   ```

## Escrituras Canary que requerirán autorización específica

### Ejecutor, bitácora y recuperación parcial

Las fases SQL se ejecutan solo mediante `runCanarySql()` en
`scripts/public-snapshot-canary-db.mjs`, con el config fijo y el handle D1
efectivamente enlazado al Worker Canary. El ejecutor consulta la identidad desde
ese mismo destino antes de cada sentencia; no acepta una identidad interna
aportada por el operador. `captureCanaryBaseline()` registra identidad, inventario
de esquema y hash/conteo de publicaciones antes de migrar. Conservar ese objeto
de baseline fuera de Git durante todas las fases. Cada respuesta debe confirmar
`success:true`; fallos o respuestas ambiguas detienen la secuencia y no se
reintentan automáticamente. El ejecutor conserva el manifiesto de sentencias
confirmadas. No ejecutar directamente el archivo de restauración ni importar el
dump completo para “deshacer” una fase parcial.

Antes/después de cada fase guardar fuera de Git el manifiesto, inventario y
conteos/hashes. Si una migración se interrumpe, detener ensayo, inspeccionar los
objetos ya creados; quitar únicamente los objetos de esa migración ausentes del
inventario inicial y cuya definición coincida exactamente con el SQL autorizado.
Si hay discrepancia, no ejecutar DROP y escalar recuperación manual limitada a
esta D1. El fixture se elimina por el prefijo + fuente + content_hash reservado.

1. Con baseline confirmado, ejecutar mediante `runCanarySql()` **solo** las
   migraciones `0032` y `0101`, y luego el fixture `scripts/public-snapshot-canary-fixture.sql`.
   El parser conserva cada bloque `CREATE TRIGGER ... BEGIN ... END` como una
   sentencia. El ejecutor verifica que se agregaron únicamente los objetos de
   esas migraciones y 152 comisiones FDCI sintéticas (76 próximas y 76 abiertas),
   sin cambiar publicaciones históricas. Su resumen de 5 KiB aproxima la carga
   máxima de la respuesta pública. La fuente y URL indican que son sintéticas.
2. Desplegar el candidato integrado **solo** al Worker Canary con el Wrangler
   cerrado y una clave temporal aleatoria en el secreto
   `PUBLIC_SNAPSHOT_CANARY_SECRET`. Antes de abrir, comprobar que el POST privado
   de cierre rechaza claves erróneas y una identidad D1 incorrecta. No registrar
   la clave ni incluirla en Git.
3. Abrir únicamente `PUBLIC_SNAPSHOT_CANARY_ENABLED=true` y
   `PUBLIC_SNAPSHOT_CANARY_UNTIL` dentro de los siguientes 300 segundos. Hacer
   exactamente dos GET sin parámetros a `/api/public-app` con la clave: uno frío,
   uno antes del TTL de 60 segundos. Correlacionar cada Ray ID, versión, HTTP,
   CPU nativa Worker y CPU nativa DO por `durableObjectId`, seis consultas D1
   previstas en frío y cero en caliente, bytes y 152 FDCI presentes. Contar
   las consultas efectivas en los spans D1 de la traza; el Invocation Log
   registra CPU por invocación, no el total D1. Si las trazas faltan, el
   conteo efectivo queda indeterminado y no se inventa a partir del código.
   Las trazas están habilitadas con muestreo 100 % solo en este Canary finito;
   comprobar antes la cuota gratuita de observabilidad. Sin
   reintentos automáticos, importaciones ni fuentes oficiales.

## Cierre y restauración

Conservar intacta la ventana original `PUBLIC_SNAPSHOT_CANARY_UNTIL` hasta cerrar;
no vaciarla ni extenderla. Antes del vencimiento, el POST privado de cierre
persiste el bloqueo de lecturas, espera las solicitudes ya admitidas y responde
HTTP 202 con `closed:false`; conserva aún el almacenamiento. Tras el vencimiento,
repetir el POST con la clave temporal: el Durable Object verifica la identidad,
cancela la alarma, ejecuta `deleteAll()` y solo entonces devuelve HTTP 200 con
`closed:true`. Si alguna limpieza falla, no declara cierre exitoso y se detiene
la restauración.

Después de HTTP 200, comprobar que el almacenamiento del objeto está vacío. No
queda marcador persistente tras `deleteAll()`; nuevas lecturas se rechazan por
el vencimiento de la ventana original, incluso después de reiniciar el objeto.
`runCanarySql({phase:'restore'})` exige el baseline conservado, vuelve a verificar
que las publicaciones históricas y el inventario esperado siguen intactos y
requiere una respuesta HTTP 200 con `closed:true` antes de ejecutar cualquier
sentencia destructiva. Revalida la identidad del mismo D1 antes de cada
sentencia y comprueba el resultado de cada una. El archivo
`scripts/public-snapshot-canary-restore.sql` es deliberadamente no ejecutable;
no usar `wrangler d1 execute --file` para restaurar.

Al iniciar ejecución, configurar el Worker a cerrado inmediatamente tras cada
fallo. Ante despliegue fallido no abrir la ventana; ante fallo de GET, vencimiento,
métrica faltante o CPU sobre objetivo, cerrar sin reintento de lectura. Si
deleteAll o restauración D1 falla, conservar clave y bundle Canary, detener
operaciones posteriores, verificar el objeto fijo por API y completar solo la
limpieza de IDs de fixture/tablas ausentes del baseline. Una lectura ambigua se
concilia con logs/Ray ID antes de cualquier segunda solicitud.

## Umbrales y presupuesto

Objetivos internos provisionales: Worker frío ≤8 ms; Worker preparado ≤5 ms;
DO frío ≤100 ms; DO preparado ≤10 ms. Límites oficiales: Worker Free 10 ms CPU
por HTTP; DO 30 s CPU por invocación. Seis consultas del DO frío y cero con
snapshot preparado; cero consultas del Worker medidas aparte; escrituras D1 en
GET = 0; lecturas D1 previstas en frío ≤400 filas de publicaciones + 1 sync +
1 checkpoint + 1 revisión + hasta 400 fechas; snapshot 0–2 MiB en DO, sin superar
los 8 MiB por valor; 152 sintéticas, 400 publicaciones totales; postcierre cero
snapshot/chunks y cero fixture tras restaurar. Los valores de filas son techo
conservador del fixture, no consumo medido. Faltan métricas nativas => inconcluso.

Presupuesto remoto previsto (estimación de trabajo, no cuota restante; incluye
preflight, ejecución, verificación, cierre y contingencias): exportar
una vez D1 (~3 MiB esperados; confirmar bytes), como máximo 2 migraciones + hasta
6 pasos de triggers/tabla, 1 INSERT fixture (152 filas), hasta 3 pre/postchecks,
dos GET, 1 cierre DO, eliminación fixture (152 filas), 8 drops de objetos de
ensayo, y hasta 20 invocaciones auxiliares de control/observabilidad. Reservar
por lo menos 25 solicitudes Worker y 25 DO además de la cuota disponible; no
comenzar si el preflight no confirma saldo suficiente para esos máximos y margen.
Lecturas de diagnóstico pueden tocar hasta 400 publicaciones por query. La cuota
real gratuita/observabilidad solo se verifica durante preflight remoto autorizado.

Luego ejecutar la fase `restore` del mismo `runCanarySql()` solo tras el cierre
confirmado y con el baseline capturado antes de las migraciones. Compara el
inventario, los datos históricos y los triggers preexistentes con ese baseline;
si difieren, no ejecutar drops ni importar el respaldo completo a ciegas:
identificar y restaurar exclusivamente la diferencia.
Retirar el secreto temporal, devolver el Worker a la versión de rutas previa que
conserva la clase DO registrada, y comprobar GET cerrado, cero Cron, ningún dato
sintético y ningún objeto con datos. El respaldo permanece local, fuera de Git.

La clase Canary no se incluye en el entrypoint productivo. La API confirmó que
la versión productiva vigente es `39780d23-fb0e-43dd-ad51-14bba15e411b` al
100 %, con dominio `docentetuc.com.ar`, D1
`baaf5886-0123-4948-96da-aa7106424549`, namespace DO
`858e9655787e4ebcb01f8b09c3d9510f`, Cron `1 * * * *` y `*/5 * * * *`.
Los secretos productivos presentes se llaman `AI_API_KEY`, `BETTER_AUTH_SECRET`,
`CRON_SECRET`, `GOOGLE_CLIENT_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY` y
`VAPID_SUBJECT`; no se leyeron sus valores. También deben preservarse las
variables de IA, autenticación, pausas y snapshot. Antes de integrar producción,
recuperar el artefacto
de esa versión y reconciliar código, rutas, bindings, Cron, variables y secretos
con el candidato, preparando rollback compatible con la clase DO ya registrada.
Esta preparación no activa FDCI diaria.
