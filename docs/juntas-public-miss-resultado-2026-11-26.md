# MISS público: resultado del único ensayo — 26/11/2026

**Dictamen: NO APTO para producción.** Se detuvo después de dos GET porque el MISS corregido sigue consumiendo 12 ms nativos con un payload de 894.126 bytes. No se inició otra ronda ni se desplegó un correctivo adicional.

## Causa y corrección ensayada

El recorrido contiene trabajo del cliente D1 (`_send`/`toJson` en el perfil local), decodificación del contenido, preparación del cuerpo y almacenamiento en Cache API. La duración SQL/espera de D1 no equivale a CPU del Worker. No se demostró que el SQL de selección sea el responsable del pico ni se cambiaron sus filtros/orden/límite.

El código funcional probado es `13ae454da46b57338ac5e8d9222ad8c3d0481df5`, basado en `97de423`. Cambia sólo el transporte interno a `hex(row_json)`/raw y decodificación nativa Buffer; prepara un Blob inmutable, con lectores independientes para caché/cliente, eliminando clone/tee y reconstrucción del texto gigante. Aumenta los bytes internos D1, pero no cambia los bytes de la respuesta pública. Mantiene contrato, contenido, selección y TTL 60 s. La portada no se modificó ni se volvió a medir.

Pruebas focalizadas: nueve aprobadas; TypeScript, ESLint y build correctos. Snapshot local representativo: respuesta de 1.934.914 bytes, idéntica byte por byte al original. Los perfiles V8 locales mantuvieron un costo importante en el transporte/driver y no se presentaron como prueba de cumplimiento nativo. No se repitió la suite general.

## Evidencia nativa

Worker exclusivo existente: `docentetuc-web-juntas-canary-1-2`. D1 exclusiva: `0979f2c2-0e96-4b5c-811b-adcccc2dbd6d`. Versión probada: `bdd0178e-f3a0-4bc7-9df4-1d809dfb0522`. Envoltorio de sólo lectura y ventana limitada, sin secretos ni concesiones. Se filtró el tail por el identificador de esta prueba.

| Caso | Bytes | CPU nativa | Wall nativo | HTTP/outcome | Ray ID |
|---|---:|---:|---:|---|---|
| BYPASS real, sin almacenar en caché | 894.126 | **8 ms** | 792 ms | 200 / ok | `a60bb7713ccd1b6a-GRU` |
| MISS real, con almacenamiento | 894.126 | **12 ms** | 749 ms | 200 / ok | `a60bb7cab9899315-GRU` |

La referencia anterior fue 16 ms en MISS. Estas muestras únicas, con diferentes condiciones de inicialización, no son un benchmark estadístico ni demuestran un porcentaje real de mejora. BYPASS ya consume 8 ms sin escribir Cache API y el MISS completo alcanza 12; la diferencia de 4 ms no puede asignarse exactamente a cache.put con una sola pareja. La operación pendiente de margen seguro es la **lectura/transporte D1 más preparación y almacenamiento del MISS**, no la portada. No basta desplazar almacenamiento a waitUntil: también cuenta en CPU de la invocación.

No hubo excepciones, 1102 ni outcome exceededCpu observado; HTTP 200/outcome ok no acreditan margen frente a 10 ms. Se detuvo inmediatamente al recuperar la medición de 12 ms.

## Muestra grande: preparada, no ejecutada remotamente

Para evitar importar publicaciones se preparó un snapshot público histórico real de 400 registros, consultable mediante un SELECT temporal parametrizado contra la D1 Canary, sin tablas nuevas ni escrituras. La validación SQLite local confirmó los mismos valores/orden. Parámetro 1.932.972 bytes; SQL 3.648 bytes; dentro de los límites documentados de tamaño de valor/SQL de [D1](https://developers.cloudflare.com/d1/platform/limits/). El transporte adicional del parámetro habría hecho el ensayo conservador, no idéntico a una lectura almacenada productiva.

Esa consulta **no llegó a ejecutarse remotamente**: falló antes el presupuesto del MISS real menor. Tampoco se ejecutaron HIT o nuevas variantes. No se afirma haber medido CPU nativa del payload productivo de 1,93 MB. El snapshot se incluyó sólo como módulo de prueba, nunca como catálogo normal ni importación D1, y dejó de recibir tráfico con el rollback.

## Cierre e integridad

Se restauró `6a2af26c-fa5f-4cdd-b402-edb4bdf4634a` al 100 %, deployment `9f188698-783f-437a-81c2-a754cfc8da8e`. Tail cerrado. No hay concesiones ni credenciales temporales que retirar. Las consultas finales confirmaron igualdad completa de datos/esquema con el preflight: 248 publicaciones, 89 revisiones, 15 checkpoints, 65 firmas y cero concesiones activas. Cero escrituras D1 durante esta tarea.

Producción no fue consultada ni modificada. No se ejecutaron migraciones, Cron, recolectores o importaciones ni se modificaron credenciales. DDJJ, Licencias, portada y demás módulos mantienen sus fuentes y documentos; el manifiesto preserva los cuatro descargables.

El commit de cierre posterior contiene únicamente este resultado y el permiso de estas dos rutas documentales en la prueba de alcance. No altera el código/artefacto funcional ensayado. Sus hashes de build deben coincidir con los del candidato `13ae454`; el SHA final queda en el manifiesto local. No es otra corrección funcional ni otra versión remota.

Evidencia ignorada: `.wrangler/miss-native/requests.json`, `native.json`, `d1-before.json`, `d1-final.json`, `snapshot-evidence.json`, logs de despliegue/rollback y `deployments-final.json`. No se propone otro despliegue ni se continúa automáticamente con más optimizaciones. El candidato no debe publicarse en producción con esta evidencia.
