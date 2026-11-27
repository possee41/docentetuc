# API pública: una respuesta preparada mediante Durable Object SQLite

## Dictamen

Prototipo local viable; NO autorizado ni certificado para producción. Recomiendo
un único Durable Object SQLite, vinculado al Worker existente. No recomiendo
seguir ensamblando el catálogo de hasta 1,93 MB dentro del Worker público.
No se modificaron rutas, consultas ni configuración desplegable de la aplicación.

## Diferencia material

El Worker HTTP transmite la respuesta del objeto mediante un binding privado:
sin consulta D1, parseo, serialización, hex decoding ni cache.put. El objeto
prepara el mismo JSON utilizando `getPublicApp` existente en modo BYPASS y
conserva sus bytes en memoria y almacenamiento SQLite, en fragmentos de 64 KiB.
Una transacción publica fragmentos y manifiesto conjuntamente; un reinicio puede
recuperar el cuerpo sin consultar ni serializar el catálogo nuevamente.

El trabajo no desaparece ni se oculta en waitUntil: se ejecuta en otro recurso,
con su propio presupuesto y métricas. La documentación oficial indica 30 segundos
de CPU por invocación para Durable Objects y disponibilidad SQLite en Workers Free:
https://developers.cloudflare.com/durable-objects/platform/limits/

## Frescura, concurrencia y contrato

- Mantiene TTL de 60 segundos desde el comienzo de la preparación/verificación;
  no utiliza stale-while-revalidate ni entrega copias vencidas ante un error.
- Una alarma comprueba periódicamente la revisión pública. Si no cambió y no
  atravesó un cambio temporal del ORDER BY, renueva la verificación sin reconstruir.
- Insertar, actualizar o borrar publicaciones o sync_state incrementaría un contador
  transaccional. Incluye cambios manuales, parciales y cambios en el mismo segundo.
  Los datos privados no invalidan ni forman parte del cuerpo público.
- Antes/después de construir se compara la revisión. Si cambió, falla cerrado con
  503; no publica un cuerpo de generaciones mezcladas ni reintenta esa preparación.
- Las fechas influyen en el SQL aunque no haya escrituras. El prototipo conserva
  su comparación TEXT con datetime('now'), incluso su tratamiento actual de `T`.
  No introduce una corrección funcional de fechas; formatos desconocidos obligan
  a regenerar cuando vence el TTL.
- BYPASS reconstruye. Si falta la copia, vence o la alarma se retrasa, el objeto
  reconstruye antes de responder. Por eso la preparación es normalmente de fondo,
  pero no exclusivamente: prohibir cualquier reconstrucción bajo demanda cambiaría
  la disponibilidad o el BYPASS actual. El Worker público nunca la realiza.
- No cambia APP_PUBLICATIONS_QUERY, campos, tipos, selección ni orden. Los endpoints
  separados de filtros, búsqueda, paginación y perfiles no se sustituyen.
- Respuesta al navegador no-store. La cabecera diagnóstica PREPARED distingue esta
  arquitectura de HIT/MISS regional; el contrato JSON permanece idéntico.

## Prototipo y pruebas reproducibles

Archivos aislados en `prototypes/public-snapshot/`; no conectados a worker-entry.

```
node --test prototypes/public-snapshot/coordinator.test.mjs
node prototypes/public-snapshot/workerd-check.mjs
```

Resultados: 9/9 pruebas. La captura pública existente de 1.934.914 bytes conserva
exactamente sus bytes después de preparación y lectura desde almacenamiento.
No se incluye esa captura en Git. Si no existe en otro checkout, la prueba utiliza
un cuerpo generado localmente de tamaño equivalente, nunca publicado como datos.

Miniflare/workerd real local con Durable Object SQLite: respuesta de 1.940.034
bytes, HTTP 200 en primera petición, repetida y después de reiniciar el runtime;
cuerpos idénticos. Cero solicitudes remotas. El adaptador TypeScript también
compila mediante esbuild. La fuente D1 del adaptador aún requiere validación
integrada: las pruebas de contrato/counter y las del almacenamiento se hicieron
separadamente; esto no equivale a probar el sistema completo en Cloudflare.

Comprobados: TTL, BYPASS, renovación sin reconstrucción, concurrencia, errores,
invalidación, rollback del contador, fechas, exclusión de cabeceras privadas,
almacenamiento y recuperación. CPU nativa Cloudflare: NO MEDIDA. Los 12 ms previos
no son una medida del prototipo. No se ha demostrado todavía el presupuesto del
Worker que transmite el stream ni la latencia añadida del objeto centralizado.

## Recursos y coste

Un namespace/clase SQLite adicional dentro del Worker existente y un único objeto;
no otro Worker, D1, R2, servicio pago ni credencial. Su registro requiere una futura
migración de clase Durable Object, distinta de las migraciones SQL D1.

Free incluye 100.000 solicitudes DO/día, 13.000 GB-s/día, 5 GB almacenados,
5 millones de filas leídas y 100.000 escritas/día en almacenamiento DO:
https://developers.cloudflare.com/durable-objects/platform/pricing/

Una alarma cada 50 segundos añade unas 1.728 invocaciones/día. Un objeto residente
todo el día a 128 MB consumiría aproximadamente 10.800–11.060 GB-s/día, antes de
otros objetos; la hibernación puede reducirlo. No ejecutar dos objetos permanentes
en paralelo sin verificar el margen compartido. Sin aumentar de plan, superar
una cuota provoca fallos, no una garantía ilimitada de servicio gratuito.

El chequeo ordinario lee una fila D1; reconstruir añade las lecturas actuales del
catálogo más la consulta de fronteras temporales. No reconstruir cada minuto:
con 11.536 lecturas por selección serían más de 16 millones/día, antes de otros
consumos. Diez reconstrucciones serían unas 115.360 lecturas de selección, más
fronteras temporales. Es una estimación local, no una cuota productiva medida.
La viabilidad económica exige medir frecuencia de cambios, filas de fronteras y
cuotas compartidas; cargas de escritura continua podrían agotar D1 Free.

## Cambios futuros y autorización necesaria

1. Autorizar registro SQLite DO y binding privado exclusivamente en Canary.
2. Autorizar un contador y seis triggers D1 locales ya prototipados en revision.sql,
   primero en Canary. NO son 0100 y no se han ejecutado remotamente. Verificar
   convivencia con triggers, esquema y restauración existentes antes de aplicarlos.
3. Conectar sólo GET /api/public-app al forwarder; conservar flags de caché
   (cache deshabilitada debe forzar BYPASS), versión, métodos y fallback de rutas.
   No copiar autorización/cookies al objeto, ni exponer endpoints de mantenimiento.
4. Medir separadamente CPU nativa del Worker público y DO con volumen de 1,93 MB:
   copia fría, caliente, vencida y BYPASS; verificar datos completos, cambios y TTL.
   Sin importaciones, cuotas contratadas, modificación productiva ni Cron nuevo.
5. Sólo después de aprobar ese resultado solicitar publicación productiva.

Rollback: devolver la ruta al lector previo y desactivar/eliminar la alarma del
objeto antes de retirar su binding; conservar la copia para diagnóstico. Retirar
los triggers/contador sólo mediante autorización SQL posterior. Un rollback del
Worker no revierte SQL ni garantiza que una alarma anterior haya sido cancelada.

DDJJ, Licencias, módulos, importadores y automatizaciones: sin cambios. Ningún
deploy, migración, importación, credencial o configuración remota ejecutados.
