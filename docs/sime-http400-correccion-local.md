# SIME_HTTP_400 — diagnóstico y corrección local

Referencia: piloto único [43391771173](https://github.com/possee41/docentetuc/actions/runs/43391771173), SHA `005eec8f16f097366c51f99de38c58bf7a8af483`.

## Causa demostrada y límite de la atribución histórica

El primer candidato **actual** de Junta 2 ordenado numéricamente es `sime:144389`. Se consultaron únicamente tres endpoints públicos SIME: período de Junta 2, vacantes del período 11/2026 y detalle de 144389. Los tres devolvieron HTTP 200 el 13/11/2026 a las 07:56:34 de Tucumán. No se utilizó el gateway, D1, credenciales ni workflow remoto. Del detalle solo se conservaron los campos públicos utilizados por el recolector, excluyendo `designado` y otros campos ajenos al contrato.

`normalizeSimeVacancy → applySimeDetail → normalizeSimeVacancy → prepareSimeImport` genera el siguiente objeto:

| Campo | Tamaño observado | Límite anterior | Resultado |
|---|---:|---:|---|
| metadata sin detalle | 14.312 caracteres | 16.000 | admite |
| metadata con detalle | **22.837 caracteres** | **16.000** | **rechaza** |
| summary | 4.169 caracteres | 8.000 | admite |
| title / area | 114 / 114 | 500 / 300 | admite |
| junta | 10 | 300 | admite |
| officialUrl | 87 caracteres | HTTPS/hostname SIME y evidencia | admite |
| contentHash | 64 hexadecimales | 64 hexadecimales | admite |
| fechas | ISO con offset -03:00, 25 caracteres | fecha válida, máximo 40 | admite |
| petición JSON completa | 28.938 bytes UTF-8 | 100.000 bytes | admite |

Los límites de strings usan `String.length`, no bytes. El límite total de petición sí cuenta bytes.

La condición que falla es `Object.entries(fields).some(([name,max]) => !clean(item[name],max))`, para `name=metadata`. La captura local del bundle Canary de la Etapa 26 contiene la misma validación `valid2` y límite `metadata:16e3`. La metadata incluye 16 puestos y repite extractos íntegros en fuentes y evidencias de fechas/instrucciones: el bloque `official` ocupa 18.299 caracteres, además de la vacante y detalle originales. `prepareSimeImport` no limita ni trunca esa metadata.

La prueba ejecuta **el handler HTTP completo**, con el mismo payload y la misma D1 SQLite local: al sustituir solamente el límite por el anterior, devuelve **400** antes de escribir; con el límite corregido devuelve **200** y persiste los valores exactos.

**Limitación importante:** el artifact del piloto conserva 12 ACK, cursor de Junta 1, `SIME_HTTP_400` y cierre, pero no el payload ni el cuerpo del rechazo. Por tanto, el desajuste de tamaño está demostrado con datos oficiales y es compatible con el primer envío de Secundaria, pero no puede certificarse que el payload histórico de las 05:18 fuera exactamente esta captura de las 07:56. No se presenta la hipótesis histórica como causalidad confirmada ni se atribuye el error a D1, CPU o autenticación.

## Cambio mínimo

En `workers/sime-receiver.mjs`, únicamente `metadata:16000 → metadata:32000`. No se modifican `prepareSimeImport`, normalización, hash, SQL, claves, seguridad, concesiones, cuotas de registros ni cursores.

Se conserva íntegra toda la información oficial; no hay `slice`, compresión ni descarte de evidencia. Se mantienen 8.000 caracteres de summary, cinco elementos por lote y 100.000 bytes por petición, además de validación de origen, metadata JSON, fechas, controles, IDs y hash. El runner sigue enviando **un registro por petición**. Un registro mayor a 32.000 seguirá rechazándose; no se pretende admitir tamaños ilimitados.

## Pruebas focalizadas

```powershell
node --experimental-strip-types --test lib/sime-import.test.ts scripts/import-sime.test.mjs lib/sime-publications.test.ts lib/sime-collector.test.ts
node --check workers/sime-receiver.mjs
git diff --check
```

Resultado: **63/63 aprobadas**. Solo fixtures y SQLite en memoria durante las pruebas; ninguna llamada real de importación.

- Reproducción HTTP 400 con límite de 16K y HTTP 200 con 32K para 144389.
- Igualdad exacta de summary, metadata, hash, junta, URL y fechas entre payload y filas SQLite.
- Replay del mismo payload: cero altas, cero actualizaciones, una sin cambios, cero escrituras.
- Metadata de 32.000 admitida; 32.001, JSON corrupto y metadata sin evidencia rechazadas sin escrituras.
- Summary, junta, título, controles, fechas, URL, ID y hash inválidos rechazados.
- Petición de más de 100.000 bytes devuelve 413 sin insertar sus registros.
- Continuación local con 12 altas previas representativas de Junta 1 y la vacante pública de Junta 2: 12 identidades previas conservadas, una nueva en Secundaria, sin duplicados; nuevo cursor de Junta 2 `sime:144389` solo después del ACK.
- Tres de las 12 previas reciben detalles antes pendientes y se actualizan legítimamente; otras nueve no cambian. No se confunde actualización por nuevos detalles con duplicación.
- Regresiones de reparto 12/12/12/12, rechazo de producción, autorización, ACK perdido, expiración, cierre independiente y checkpoint HALTED se mantienen.

Se detectó además una expectativa antigua incorrecta en un test de importación: esperaba una escritura parcial antes de completarse la recolección. Se reprodujo el fallo con el test original del SHA aprobado. Se corrigió **solo su preparación**, sembrando primero una fila confirmada y verificando que el fallo conserva esa fila y el último éxito; no se cambió el comportamiento del importador.

La comprobación de las 12 filas **reales** persistidas permanece en el informe anterior. Las nuevas pruebas no leen D1 remota ni clonan datos privados: demuestran idempotencia estructural con 12 filas representativas. La clave `id`, el filtro source y el hash no cambian.

## Nueva prueba Canary: requiere autorización independiente

1. Autorizar publicación selectiva de la corrección y despliegue **solo del módulo receptor SIME en el gateway Canary existente**, conservando código ajeno, bindings, credencial dedicada y configuración inicial cerrada. Cambiar solo el runner no soluciona una validación ejecutada en el Worker. No se realizó aquí ninguna publicación ni despliegue.
2. Fijar el nuevo SHA publicado en la autorización, preservando protecciones del Environment. Antes de abrir: verificar UUID Canary `853e2f5d-89b1-46a3-9c1c-5cbd46784756`, esquema/cuota y cero concesiones, disponer de ambos cierres y de copia recuperable según el protocolo existente.
3. Autorizar **una corrida nueva**, nunca un rerun de 43391771173: `target=canary`, `juntas=1,2,3,4`, `limit=50`, `resume_after` vacío. No se cambia el contrato de seguridad ni se introduce un ejecutor alternativo para seleccionar solo Junta 2.
4. No cargar ni convertir automáticamente el checkpoint HALTED. Un recorrido nuevo relee lo existente y deduplica por ID/hash: Junta 1 puede confirmar hasta 12 registros existentes (sin cambios o actualizados legítimamente), Junta 2 obtiene hasta 12 slots independientes; Juntas 3 y 4 conservan sus 12 slots. Los dos slots sobrantes siguen sin utilizarse.
5. Guardar por ACK un **nuevo** vector de cursores por junta. Conservar el reporte HALTED original como evidencia. No descartar los primeros registros de Secundaria por usar el cursor de Junta 1. Una reanudación posterior con vector no vacío requerirá revisión y autorización propias: el workflow actual exige vacío antes de importar y no debe eludirse.
6. No reintentar ante 400, error D1, ACK ambiguo, vencimiento, fallo de permisos o exceso de CPU. Capturar un código de validación/payload saneado solo si está disponible por mecanismos autorizados; no imprimir datos personales ni credenciales. Cerrar siempre, comprobar cero concesiones y restaurar flags/run-ID como en el protocolo aprobado.

## Riesgos y estado final

No se midió CPU real del payload de 28.938 bytes en Cloudflare. El techo global de petición permanece igual, pero ampliar el tamaño admitido de un campo puede aumentar el trabajo de una solicitud concreta. La prueba local no acredita cumplimiento de Workers Free. Futuras ofertas más grandes pueden exceder 32K o el límite total; deberán fallar de forma explícita, sin truncamiento ni avance de cursor.

**Corrección local validada; atribución exacta del payload histórico pendiente de evidencia. No se declara aptitud productiva.** Gateway y producción no se modificaron, y no hubo escrituras D1 remotas, sincronizaciones, cambios de secretos/variables/permisos ni segunda ejecución del piloto.
