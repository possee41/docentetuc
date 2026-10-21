# Piloto FDCI externo (sin activación productiva)

Base de esta rama: `d321e7225e7dc75ff76a0e612525386855e05e08`. El Worker principal, su Cron y `docentetuc-db` no cambian en este piloto.

## Recorrido acotado

El workflow es solo manual, acepta token/slug/ID de una comisión y fija el código ejecutado mediante `FDCI_IMPORT_REF` (SHA completo). Node consulta el catálogo y las activas solo para encontrar el curso seleccionado, solicita su detalle público y prepara **una** publicación. El receptor independiente autentica y admite como máximo cinco publicaciones por solicitud. No genera avisos, no modifica `sync_state`, no reconcilia ausencias ni retira publicaciones. GitHub conserva el último intento, éxito/error y conteos en el historial y resumen de cada ejecución; esto no representa una sincronización completa de FDCI.

La configuración `wrangler.fdci-pilot.jsonc` usa exclusivamente la D1 canary `docentetuc-fdci-canary-1-1` (`713a8c37-d123-43ce-9f9e-7789e60e3d21`), sin dominios, assets ni Cron. `FDCI_EXTERNAL_ENABLED` habilita solo este canary. La importación productiva permanece cerrada porque el Worker productivo no tiene ese valor.

## Exclusión y transición pendiente

El canary está aislado por base y no comparte escritor con el recolector legacy. Para producción, un simple chequeo por request **no** demuestra exclusión frente a una invocación legacy anterior. El lease D1 ensayado previamente elevó el receptor a 11 ms de CPU y no se incorpora aquí. Antes de conectar `docentetuc-db` habrá que acordar un corte coordinado: impedir nuevas invocaciones legacy de FDCI, comprobar que terminaron las anteriores, recién entonces habilitar el receptor externo. El workflow mantiene concurrencia serial y el UPSERT evita duplicados, pero eso no sustituye la verificación del corte. Si no puede demostrarse, no activar producción.

## Verificación y criterio de avance

1. En local, probar fuente simulada → Node → receptor → D1 aislada → formato usado por la interfaz. Verificar fechas, cupo disponible cero, enlace oficial, repetición sin escrituras y conservación del histórico.
2. En el canary, verificar bindings efectivos antes de publicar, guardar versión anterior, usar secreto **sintético** temporal y medir CPU facturada/consultas/filas de una publicación y, solo con margen, de cinco. Retirar el secreto al terminar.
3. Una lectura puntual de la ficha oficial debe confirmar una comisión vigente o próxima para la prueba real; no usar datos sintéticos como si fueran hechos actuales.
4. No conectar GitHub Actions a producción ni programarlo hasta que el corte de escritores y el presupuesto de CPU estén demostrados. La mera respuesta HTTP 200 no basta.

Si el receptor aislado con exclusión segura supera los 10 ms o carece de margen, detener esta vía en Workers Free y evaluar persistencia en un ejecutor externo con credenciales mínimas específicas, **sin** crear por adelantado un token general de D1.

## Resultado de la prueba aislada del 21/10/2026

- Base de prueba confirmada: `713a8c37-d123-43ce-9f9e-7789e60e3d21`. Versión canary anterior: `bed1afa6-6e33-4348-bf70-694d473d0364`; versión de código del piloto: `2690e18f-0004-4a12-9084-446cccbf4538`.
- Dos inserciones sintéticas individuales respondieron HTTP 200: 2 consultas D1, 0 filas leídas y 3 filas escritas informadas por cada invocación. Sin autorización respondió 401. No se ejecutó el lote de cinco porque faltó la métrica de CPU.
- El tail en vivo informó resultado `ok`, pero no entregó `cpuTimeMs`; el tiempo de pared no lo reemplaza. Por tanto, **no está demostrado el cumplimiento del límite de CPU** ni la equivalencia del corte de escritores en producción.
- El secreto sintético temporal se retiró. La versión canary activa `f2b7db13-07fd-4ac5-9adc-3f245a70fde1` conserva solo el binding D1 de prueba y la variable de compuerta; sin secreto devuelve 503 y no puede escribir.
- La ficha oficial seleccionada no pudo consultarse desde este entorno. El caso #6397 del ensayo es una captura sintética basada en los campos conocidos, no una verificación en vivo ni una publicación reciente comprobada. Antes de cumplir la aceptación faltan una consulta pública puntual de la fuente y una medición de CPU facturada del receptor con exclusión segura de escritores.

La prueba visual local posterior sí completó el tramo restante con una comisión totalmente sintética: el recolector Node preparó un registro, el receptor localhost lo insertó en la D1 local (2 consultas; 5 filas escritas informadas por Workerd), `/api/public-app` lo devolvió y la pantalla móvil de Capacitaciones mostró la tarjeta y el detalle con apertura, cierre y **0 cupos disponibles**. Como este piloto puntual no marca todo el catálogo como sincronizado, la interfaz mostró correctamente «Vigencia por verificar»; no anunció una vacante disponible. La URL local es `http://127.0.0.1:8793/?section=capacitaciones` mientras permanezca levantado el servidor. Esto verifica la interfaz con datos sintéticos, pero no reemplaza la prueba con una publicación oficial leída en vivo.
