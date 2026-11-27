# Resultado Canary: respuesta pública preparada con Durable Object SQLite

**Dictamen: APTO en CPU y contrato para integrar la arquitectura en la publicación
productiva de Juntas. No se autoriza ni se ha realizado publicación productiva.**
El prototipo de medición no debe copiarse como configuración de producción: incluye
una ventana de prueba y una captura histórica exclusivamente para medir volumen.

## Código y entorno comprobados

- Código de preparación/TTL/almacenamiento: `69b92fb114471e80c015c1f6dd2b64421982e773`.
  Los hashes de sus tres archivos funcionales coinciden con el commit aprobado.
- Worker: `docentetuc-web-juntas-canary-1-2`.
- Candidato desplegado: `51e1ff3f-e447-495e-9fc0-6b979f68d52a`.
- D1: `0979f2c2-0e96-4b5c-811b-adcccc2dbd6d`, nunca la productiva.
- Un namespace SQLite nuevo, clase `PublicSnapshot`; dos objetos temporales para
  separar los datos Canary y el volumen representativo. En producción se propone uno.
- Ocho GET de medición, dos simultáneos; ninguna recolección ni importación.

## CPU nativa individual Cloudflare

| Caso | Bytes | Worker público | Durable Object |
|---|---:|---:|---:|
| Canary frío | 894.126 | 0 ms | 31 ms |
| Canary preparado | 894.126 | 1 ms | 5 ms |
| Representativo frío, dos GET simultáneos | 1.934.914 | 0 y 1 ms | 24 y 30 ms |
| Representativo preparado | 1.934.914 | 1 ms | 7 ms |
| Canary vencido, revisión cambiada | 894.126 | 0 ms | 17 ms |
| Representativo vencido, revisión cambiada | 1.934.914 | 0 ms | 55 ms |
| Representativo BYPASS | 1.934.914 | 0 ms | 42 ms |

Fuente: eventos `wrangler tail`, separados por `durableObjectId`, no por el nombre
del script ni por la presencia de logs. Ambas ejecuciones usan el mismo nombre
de Worker. Cero milisegundos es el valor informado con esa resolución, no CPU
literalmente inexistente. Las invocaciones simultáneas pueden compartir trabajo;
sus CPU no se deben sumar para atribuir el costo de una sola reconstrucción.

Todas las mediciones terminaron HTTP 200/outcome `ok`, sin excepciones ni 1102.
Cinco alarmas observadas consumieron 2–5 ms de CPU. Las magnitudes son CPU nativa,
no latencia de cliente, tiempo D1 ni perfil V8 local. No se midió por separado
el tiempo de arranque del isolate; no se lo presenta como CPU de solicitud.

El máximo del Worker HTTP fue 1 ms frente al presupuesto de 10 ms. El máximo
del objeto fue 55 ms, frente a sus 30 segundos por invocación. No se intenta
hacer pasar esos 55 ms como una solicitud Worker Free de menos de 10 ms:
el trabajo se trasladó explícitamente a un recurso con otro presupuesto.

Referencia oficial: https://developers.cloudflare.com/durable-objects/platform/limits/

El MISS anterior fue 12 ms del Worker con sólo 894.126 bytes. En esta arquitectura
la primera petición de ese volumen dio 0 ms del Worker y 31 ms del objeto. Es una
comparación de arquitectura, no una afirmación de ahorro total de CPU ni una
medición estadística de percentiles sostenidos.

## Contrato, frescura y concurrencia

- Los ocho cuerpos coinciden byte por byte con sus referencias. El cuerpo real
  Canary contiene sus 248 publicaciones. La captura de 1.934.914 bytes es pública,
  contiene 400 publicaciones y se consultó como CTE parametrizada, sin insertarla
  en D1. Esa preparación tiene sobrecosto de transporte de parámetros y no mide
  las lecturas SQL físicas de la base productiva.
- Se conservan todos los campos, tipos, arrays personales vacíos, selección y
  orden del SQL original. Las rutas de búsqueda, filtros y paginación no cambiaron.
- Cada respuesta se comprobó antes de su vencimiento. Las dos pruebas de renovación
  comenzaron después del vencimiento original: no reutilizaron su copia vencida.
- Se incrementó sólo el contador experimental de revisión, mediante CAS `0 → 1`.
  Ambos objetos reconocieron la revisión 1 y reconstruyeron sus cuerpos.
- Los dos GET simultáneos en frío compartieron fecha de expiración y cuerpo;
  los logs registran una sola reconstrucción para ese par, sin errores.
- No se insertó ni modificó una publicación para probar frescura remota. La prueba
  adicional local conecta SQL real + esquema observado + triggers SQLite + lector:
  inserta un fixture, mantiene la copia dentro del TTL y muestra el registro nuevo
  al vencerlo. Esto distingue invalidación remota comprobada de mutación documental
  verificada localmente, sin atribuir a Canary una importación que no ocurrió.
- Pruebas focalizadas: 9/9 existentes y 1/1 integración SQL nueva, aprobadas.
  El archivo nuevo necesita la captura y el esquema locales; se omite explícitamente
  si no están disponibles, sin descargar ni consultar nada remotamente.

## Integridad y cierre

Se compararon hashes SHA-256 del contenido completo y ordenado antes y después:
248 publicaciones, 89 revisiones, 15 checkpoints y 65 firmas: **idénticos**.
Los tres triggers históricos originales también conservan su definición exacta.
Se crearon únicamente el contador y seis triggers adicionales; al terminar se
retiraron esos siete objetos. No se volvió a ejecutar 0100 ni se alteraron columnas.
La creación del esquema y la invalidación contabilizaron 10 filas D1 escritas;
ninguna fue una publicación, revisión, checkpoint o firma.

Ambos objetos fueron cerrados, sin alarmas y con almacenamiento eliminado.
La API de namespaces devolvió una lista vacía de objetos con datos al final.
No se abrió el receptor ni ninguna concesión; cero leases activos. No se cambió
ningún secreto, no se configuró Drive y no se habilitó Cron.

**Restauración:** registrar una clase DO impide rollback a versiones anteriores
a ese registro. Se comprobó antes de modificar y se preparó una versión con las
rutas originales y los 253 archivos del artefacto original verificados por hash.
Al terminar se restauró esa versión al 100 %:

- Original de referencia: `6a2af26c-fa5f-4cdd-b402-edb4bdf4634a`.
- Mismo código de rutas restaurado, más la clase inactiva:
  `7930c830-d3ff-463c-b62d-e422ee659c65`.
- Deployment final: `0df4746c-7027-4ae5-b095-ac8cb0cf8d4c`.
- Namespace retenido, vacío: `fd5a575222df418ca357f59e87ab3183`.
- La ruta pública vuelve a su cuerpo neutral anterior y Padrones responde 200
  con `items`, `nextCursor` y `coverage`. El endpoint experimental ya no se enruta.

No se eliminó la clase registrada mediante otra migración: queda documentada e
inactiva. No corresponde afirmar que se recuperó el identificador 6a2af26c.
Referencia: https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/

## Cuotas y limitaciones

Se observaron 15 eventos DO: 8 GET, 5 alarmas y 2 cierres. Son el 0,015 % de
100.000 solicitudes DO/día. La suma de sus tiempos de pared fue 3.293 ms:
aplicar 128 MB da aproximadamente 0,42 GB-s como modelo por eventos, **no una
lectura de facturación**; concurrencia, residencia y hibernación cambian la cifra.

Modelo diario para un solo objeto: 1.728 alarmas a 50 segundos más solicitudes
públicas, dentro de 100.000 invocaciones DO/día. Incluso residente todo el día,
128 MB representan unos 11.059 GB-s frente a 13.000 GB-s/día, compartidos con
otros objetos. Evitar dejar dos objetos permanentes o temporizadores que impidan
hibernación. El almacenamiento es de unos pocos MB, frente a 5 GB Free.

D1 mantiene su cuota compartida: las verificaciones ordinarias leen una fila;
la selección y las fronteras temporales sólo se repiten ante cambios, vencimientos
temporales o BYPASS. No reconstruir el catálogo completo cada minuto. El consumo
por invocación DO no se expuso como un total D1 en las trazas; no se inventa.

Los metadatos de suscripción respondieron 403; no se repitió esa consulta ni se
cambiaron permisos. No se verificó una cuota remanente global ni se contrató Paid.
Las cifras son presupuestos del plan y estimaciones, no consumo agregado de cuenta.
Referencia: https://developers.cloudflare.com/durable-objects/platform/pricing/

## Procedimiento definitivo preparado para Juntas

1. Antes de publicar, identificar la versión productiva y sus fuentes efectivas.
   Integrar sólo Juntas ya reconciliado y la respuesta preparada; conservar DDJJ,
   Licencias y módulos actuales. No utilizar el wrapper ni la captura de esta prueba.
2. Preparar el entrypoint con un binding privado y una única identidad de objeto.
   Exportar la clase compilada y enrutar sólo GET /api/public-app. Preservar flags
   de caché, BYPASS y versión del caché; incluir la revisión del ejecutable en la
   identidad del snapshot para no reutilizar cuerpos de una versión incompatible.
   Las rutas privadas y los demás endpoints conservan sus handlers actuales.
3. Obtener recuperación D1 y aplicar sólo el contador/triggers, con verificación
   de compatibilidad. No repetir 0100. Los triggers contabilizan también escrituras
   manuales y borrados, sin modificar importadores ni automatizaciones existentes.
4. Registrar la clase SQLite manteniendo las rutas productivas anteriores, dejando
   esa nueva versión como rollback verificable. Este registro necesita autorización
   expresa: el identificador productivo previo al registro dejaría de ser un destino
   de rollback válido, aunque se conserve su código.
5. Activar el lector preparado en el candidato integrado, con warm-up previo a la
   asignación de tráfico y sin construir snapshots personalizados. Verificar contrato,
   CPU de ambos recursos, navegación Juntas/DDJJ y cuota compartida.
6. Preparar un cierre privado autenticado independiente que cancele la alarma;
   el control de suspensión debe permitir consultas públicas seguras sin servir copias
   vencidas. Si falla el objeto, responder 503 y conservar evidencias, sin caer en el
   constructor HTTP antiguo ni afirmar que el fallo se resolvió.
7. Ante regresión, cancelar la alarma y devolver tráfico a la versión de rutas
   anteriores creada después del registro DO. No revertir D1 indiscriminadamente.
   Retirar contador/triggers sólo mediante limpieza selectiva autorizada.

La autorización productiva necesaria comprende publicación selectiva del candidato
integrado final, contador D1, registro SQLite DO y despliegue/activación supervisados
con ese mecanismo de recuperación. **No incluye importaciones, Drive, nuevos Cron,
notificaciones ni activación de sincronización Juntas.**

Evidencia verificable y segura:
`docs/evidence/2026-11-26-public-snapshot-canary.json`.
