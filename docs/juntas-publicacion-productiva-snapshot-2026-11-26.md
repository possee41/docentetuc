# Juntas publicado en producción con respuesta pública preparada

**PUBLICACIÓN REALIZADA.** Se conserva la versión integrada, sin ejecutar
importaciones ni activar nuevas sincronizaciones. Esta es evidencia productiva,
no una repetición de la validación Canary.

| Elemento | Resultado |
|---|---|
| Worker | `docentetuc` |
| Código integrado | `0bc583aae1c7a3b23b09aa8298ddf9fc900cf257` |
| Base productiva preservada | `85c4a912c346bb480e5707639e3a82ae48a5b866` |
| Versión inicial comprobada | `6fb7a6a2-1552-4e43-9e2d-9d054e370419`, 100 % |
| Versión final | `028c43fb-200a-43c4-8848-0aa385dd7215` |
| Deployment final | `8a72df3c-3ce1-4712-9f61-245328bb341f` |
| Tráfico final | 100 % |
| D1 | `docentetuc-db`, `baaf5886-0123-4948-96da-aa7106424549` |
| Namespace SQLite nuevo | `858e9655787e4ebcb01f8b09c3d9510f` |

## Cambio publicado

Se integró el coordinador probado de 69b92fb con el candidato reconciliado de
Padrones y Comunicados. La API pública pasa por un binding privado a un solo
objeto fijo; los endpoints privados, OAuth y demás módulos conservan sus handlers.
El Worker transmite los bytes ya preparados sin reconstruir el JSON en cada HTTP.

**No hay alarmas periódicas.** La primera lectura después de vencer el TTL consulta
la revisión y sólo reconstruye si hubo cambios, una frontera temporal del SQL o
una nueva versión de código/caché. Si no hubo cambios, renueva la verificación y
reutiliza los mismos bytes. Con el sitio sin tráfico no genera trabajo periódico.
Se conserva TTL de 60 segundos, BYPASS y rechazo de copias vencidas ante fallos.
Una alarma heredada se cancelaría, sin reprogramarse.

El SHA del código se incorpora al bundle y al manifiesto de la copia persistente;
una versión incompatible no puede reutilizar el JSON de la anterior. No se envían
cookies ni autorización del usuario al objeto. El marcador de diagnóstico sólo
correlaciona lecturas públicas y no autoriza escrituras ni acceso privado.

## CPU nativa en producción

| Solicitud medida | Worker HTTP | Durable Object |
|---|---:|---:|
| Preparación inicial antes de activar Juntas | 0 ms | 32 ms |
| API preparada/renovada, versión final | 1 ms | 7 ms |
| API después de vencer nuevamente el TTL | 1 ms | 6 ms |
| Portada | 1 ms | — |
| HTML Padrones y Comunicados | 0 ms | — |
| API Padrones, 50 documentos | 3 ms | — |
| API Comunicados, vista individual vacía | 1 ms | — |

Son eventos nativos de Cloudflare, identificados por versión y durableObjectId;
no son tiempos de cliente ni CPU V8 local. Todos finalizaron HTTP 200/outcome ok,
sin excepciones. El Worker HTTP quedó por debajo de 10 ms. Los 32 ms de preparación
se ejecutaron en el objeto con su presupuesto propio, no en el Worker HTTP.
La preparación inicial utilizó la versión de restauración con la misma clase
compilada del candidato; las mediciones posteriores corresponden a la versión final.

El cuerpo real productivo tiene **1.934.914 bytes** y 400 publicaciones: se comparó
byte por byte con el SQL productivo vigente. No se usó un fixture ni una CTE de
datos capturados. SHA-256 del cuerpo:
`8a704ca24b3a578419bdef7258492609638b83c1de41666e0243c1d1d761eab1`.
El catálogo seleccionado conserva 281 SIME, 64 INFoD, 36 CeNET y 19 informaciones.
Ocho GET de medición son una comprobación acotada, no percentiles de carga sostenida.

## D1, compatibilidad y recuperación

Antes de escribir se registró el bookmark Time Travel:
`000025f6-00000000-0000512f-0f7b93ab648be4c7dc4e538f21dbc642`.

Se aplicó únicamente `0101_public_snapshot_revision.sql`: un contador inicial y
seis triggers de invalidación sobre publicaciones y sync_state. Su aplicación se
registró en d1_migrations. **0100 no se ejecutó nuevamente**; se verificaron su
tabla de historial y sus tres triggers existentes. No se cambiaron columnas,
índices, registros documentales ni otros datos de aplicación.

Se calcularon hashes completos de las 7.139 publicaciones antes y después, leyendo
en lotes: coinciden exactamente. Se conservan 3.454 registros de Padrones y cuatro
referencias generales de Comunicados. Revisiones, checkpoints y firmas productivas
continúan en cero, tal como estaban antes: no se copiaron los datos de Canary.
La revisión del contador quedó en 0 y no hay concesiones activas.

Se conservaron los 15 bindings previos y sus valores públicos, incluidas D1 y la
configuración OAuth. No se leyeron ni cambiaron valores de secretos. El dominio y
su identidad se conservaron. Los dos Cron previos permanecen exactamente en
`1 * * * *` y `*/5 * * * *`; no se agregó ninguno ni se modificó GitHub Actions.

El registro de una clase DO impide volver directamente a una versión anterior a
ese registro. Por eso se compiló la base 85c4a91 en un checkout separado y se
registró primero una versión de restauración con las rutas productivas anteriores,
la clase adicional y Snapshot deshabilitado para las solicitudes normales:

**Rollback compatible: `2d817125-3063-4af1-bc29-3dc55357ae5f`.**

```
node node_modules/wrangler/bin/wrangler.js versions deploy 2d817125-3063-4af1-bc29-3dc55357ae5f@100 --config .wrangler/snapshot-production/traffic.json --yes
```

No utilizar 6fb7a6a2 como destino directo de rollback tras registrar la clase. No
restaurar toda D1 indiscriminadamente: el rollback de código no revierte SQL y
puede haber datos legítimos posteriores al bookmark. El esquema 0101 es aditivo
y compatible con las rutas anteriores; su retirada, si fuera necesaria, debe ser
selectiva. No hay alarmas que mantener abiertas ni un receptor temporal habilitado.

## Comprobaciones visibles y límites de contenido

- Navegación real en https://docentetuc.com.ar: Padrones muestra documentos oficiales,
  enlaces, período y avisos de histórico/provisorio. API devuelve 50 y nextCursor.
- Comunicados carga correctamente la vista y filtros. Devuelve **cero individuales**:
  producción aún sólo contiene cuatro referencias generales. La pantalla informa
  que no hay documentos indexados y que eso no demuestra ausencia de novedades.
  No se presentaron referencias como comunicados individuales ni se inventaron datos.
- Información útil → Trámites muestra las tarjetas DDJJ PDF y Word. Licencias muestra
  su ficha y ambos formularios. Las cuatro descargas responden 200 y sus bytes
  coinciden con los documentos de la base 85c4a91.
- /api/auth/status responde 200, configured=true y authenticated=false para la
  comprobación anónima. No se realizó un nuevo login ni se alteró autenticación.
- No se importó ningún documento. Los definitivos y comunicados nuevos recuperados
  únicamente en Canary requieren su recuperación productiva posterior, mediante
  el procedimiento de importación autorizado que corresponda. La cobertura no se
  declara completa ni se fabrican checkpoints PARTIAL que no existen en producción.

## Recursos y pendientes

Existe un namespace productivo SQLite y un objeto con datos; no hay bucle de
alarmas ni las aproximadamente 1.728 invocaciones diarias del prototipo. El primer
inventario REST aún no listó el objeto; una lectura posterior sí mostró el mismo ID
de las trazas con hasStoredData=true. Fue un desfase de inventario observado, no un
fallo HTTP de la aplicación ni una pérdida de la copia persistente.

El consumo futuro depende de solicitudes y cambios reales, dentro de las cuotas
Free compartidas. No se contrató Paid, no se crearon credenciales, no se configuró
Drive y no se volvió a consultar el endpoint de suscripciones previamente denegado.
Las trazas no proporcionan una cifra exacta de consumo D1 total de las invocaciones
DO; no se inventa. Las lecturas de integridad fueron 7.139 antes y 7.139 después;
la referencia SQL leyó 15.532 filas. No se repitieron pruebas masivas ni la suite general.

Código nuevo: 7/7 pruebas focalizadas aprobadas, dos comprobaciones de conservación
de módulos aprobadas, TypeScript, ESLint y build correctos. El monitor tail quedó
cerrado al terminar. No se ha activado ninguna sincronización de Juntas.

Pendiente real: **recuperar documentos oficiales e individuales en producción**;
la publicación del código y la solución de CPU ya están realizadas. Evidencia:
`docs/evidence/2026-11-26-juntas-snapshot-production.json`.
