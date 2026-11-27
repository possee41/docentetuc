# Corrección focalizada MISS — candidato, 26/11/2026

Base `97de423299a6322d6a031fe5a63c9f7fb73d38dc`. Rama `local/juntas-public-miss-20261126`. El SHA final se registra en el manifiesto después del commit.

## Trabajo identificado y cambio preparado

El MISS anterior consume 16 ms nativos con 894.126 bytes. Esa única muestra no atribuye por sí sola CPU a una fase. Los perfiles locales del snapshot de 1.934.914 bytes ubican el costo mayor en `_send`/`toJson`, decodificación D1, y muestran además armado/codificación del cuerpo y almacenamiento mediante un flujo clonado. La primera variante local con sólo raw/Blob no demostró resolver el transporte: una muestra atribuyó 62,972 ms a `_send`. No se publicó esa variante ni se hizo una prueba remota con ella.

Único candidato final:

- Conserva literalmente `APP_PUBLICATIONS_QUERY`, selección, orden, límite y la proyección de los mismos 35 campos.
- Añade `hex(row_json)` sólo para el transporte D1. Devuelve una columna ASCII, leída con `raw()`, y decodifica sus bytes mediante `Buffer.from(..., 'hex')` nativo. Evita volver a materializar objetos y procesar grandes cadenas JSON escapadas dentro de otra respuesta JSON.
- Construye un Blob inmutable con las filas y separadores; crea lectores independientes para Cache API y cliente, sin `Response.clone()`/tee y sin construir/codificar otra cadena gigante.
- Conserva TTL 60 s, clave/versionado de caché, bypass de parámetros desconocidos, expiración, privacidad y manejo de fallos. No usa waitUntil como supuesto ahorro de CPU; el trabajo sigue formando parte de la invocación.

Tradeoff: los bytes D1 internos aumentan aproximadamente al doble; el cuerpo HTTP al cliente no cambia. No se cambia esquema, índice ni contenido almacenado. Cada fila se codifica por separado, evitando un agregado único de todo el catálogo. La aprobación depende de CPU nativa y no se infiere del perfil local ni del HTTP 200.

## Validación local ejecutada

Payload real de referencia: 400 publicaciones, 1.934.914 bytes. El resultado final coincide byte por byte con el anterior. Snapshot público SHA-256 `18f6a9cabf4883b16858754ac983d416f72ea644dddd608f99fc0d5f94128431`, usado únicamente en SQLite local; no se importa a D1 remota.

Tres solicitudes de perfil local, sólo MISS/HIT/BYPASS, sin volver a medir portada. V8 local muestreado: MISS 71,422 ms (baja resolución y 49,523 ms en `(program)`), HIT sin muestras activas, BYPASS 52,344 ms (44,5 ms en `(program)`). Estos valores no son CPU nativa ni prueban un margen de 10 ms; no se ocultan los tiempos residuales. Se conservaron perfiles y resultados en `.wrangler/miss-final/representative/`.

Nueve pruebas focalizadas aprobadas: contrato JSON/Unicode/nulls/metadatos grandes, rutas privadas, cuerpo representativo mayor de 1,9 MB sin clone, caché y cliente con bytes idénticos, TTL, dos usuarios sintéticos, errores DB y bypass. Se omitieron el test de portada y el benchmark repetitivo. TypeScript, ESLint focalizado y build correctos.

La portada, DDJJ, Licencias y demás módulos no tienen cambios de fuente. Se conserva el empaquetado que comprueba los cuatro documentos descargables. No se ejecutó 0100, ni se alteraron D1, Cron, credenciales o datos productivos.

## Única validación Canary autorizada

Usar el Worker existente `docentetuc-web-juntas-canary-1-2` y D1 `0979f2c2-0e96-4b5c-811b-adcccc2dbd6d`. Sólo SELECT, sin concesiones, imports o nuevos recursos. Registrar versión anterior, identidad e integridad antes/después; guardar CPU nativa por ruta y restaurar la versión anterior ante CPU >=10 ms, error o incertidumbre.

Primero, BYPASS real para aislar el costo de lectura/transporte; después MISS real. Si supera CPU, detener la prueba sin nuevas variantes o despliegues correctivos. Si pasa, comprobar MISS/HIT con una muestra de tamaño productivo sin escribir D1. Cualquier representación mediante snapshot/SELECT temporal debe identificarse como prueba, comparar exactamente los bytes y declarar el costo adicional del transporte de parámetros; no se presentará como catálogo vivo ni se aprobará un resultado menor como si fuera productivo. No usar la caché precargada para fingir un MISS.

El resultado remoto se registrará en un informe separado para no cambiar el SHA probado. No se autoriza despliegue productivo. Rollback productivo conservado: `6fb7a6a2-1552-4e43-9e2d-9d054e370419`. No repetir 0100.
